-- RPC to materialize recurring route_appointments from recurring jobs (no cron).
-- Keeps existing one-to-one sync row (route_appointments.job_id) and creates
-- additional future occurrences linked by source_job_id.

ALTER TABLE public.route_appointments
  ADD COLUMN IF NOT EXISTS source_job_id uuid REFERENCES public.jobs(id) ON DELETE CASCADE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'route_appointments_source_job_slot_key'
      AND conrelid = 'public.route_appointments'::regclass
  ) THEN
    ALTER TABLE public.route_appointments
      ADD CONSTRAINT route_appointments_source_job_slot_key
      UNIQUE (source_job_id, scheduled_date, scheduled_time);
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_route_appointments_source_job_id
ON public.route_appointments(source_job_id)
WHERE source_job_id IS NOT NULL;

COMMENT ON COLUMN public.route_appointments.source_job_id IS
  'Recurring occurrence source link to jobs.id. Base synced row keeps job_id; generated future rows use source_job_id.';

CREATE OR REPLACE FUNCTION public.normalize_job_recurring_frequency (p_frequency text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_norm text;
BEGIN
  v_norm := regexp_replace(lower(coalesce(p_frequency, '')), '[^a-z0-9]+', '', 'g');

  IF v_norm IN ('daily', 'everyday') THEN
    RETURN 'daily';
  ELSIF v_norm IN ('weekly', 'everyweek') THEN
    RETURN 'weekly';
  ELSIF v_norm IN ('biweekly', 'every2weeks', 'everytwoweeks', 'fortnightly') THEN
    RETURN 'biweekly';
  ELSIF v_norm IN ('monthly', 'everymonth') THEN
    RETURN 'monthly';
  END IF;

  RETURN '';
END;
$$;

COMMENT ON FUNCTION public.normalize_job_recurring_frequency (text) IS
  'Normalizes recurring frequency labels (daily/weekly/biweekly/monthly). Returns empty string when unsupported.';

CREATE OR REPLACE FUNCTION public.generate_job_recurring_appointments (
  p_job_id uuid,
  p_occurrences integer DEFAULT 12,
  p_replace_future boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_job public.jobs%ROWTYPE;
  v_route_id uuid;
  v_frequency text;
  v_start_date date;
  v_cursor date;
  v_end_date date;
  v_duration_int integer;
  v_weekdays int[] := ARRAY[]::int[];
  v_weekday_item text;
  v_should_insert boolean;
  v_created integer := 0;
  v_deleted integer := 0;
  v_target integer := GREATEST(COALESCE(p_occurrences, 12), 1);
  v_upper_guard integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT *
  INTO v_job
  FROM public.jobs
  WHERE id = p_job_id
    AND user_id = v_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job not found or not allowed';
  END IF;

  IF v_job.job_type <> 'recurring' THEN
    RAISE EXCEPTION 'Job % is not recurring', p_job_id;
  END IF;

  IF v_job.client_id IS NULL THEN
    RAISE EXCEPTION 'Recurring jobs require client_id to generate appointments';
  END IF;

  IF v_job.status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'Cannot generate recurring appointments for % jobs', v_job.status;
  END IF;

  v_frequency := public.normalize_job_recurring_frequency(v_job.recurring_frequency);
  IF v_frequency = '' THEN
    RAISE EXCEPTION 'Unsupported recurring_frequency: %', coalesce(v_job.recurring_frequency, 'null');
  END IF;

  v_route_id := public.resolve_job_route_id(v_job.user_id, v_job.route_id);
  v_start_date := v_job.scheduled_date;

  IF p_replace_future THEN
    DELETE FROM public.route_appointments ra
    WHERE ra.source_job_id = p_job_id
      AND ra.scheduled_date >= v_start_date;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
  END IF;

  -- Optional bounded horizon when duration is numeric.
  BEGIN
    v_duration_int := NULLIF(trim(coalesce(v_job.recurring_duration, '')), '')::integer;
  EXCEPTION
    WHEN others THEN
      v_duration_int := NULL;
  END;

  IF v_duration_int IS NOT NULL AND v_duration_int > 0 THEN
    CASE lower(coalesce(v_job.recurring_duration_unit, 'months'))
      WHEN 'day', 'days' THEN
        v_end_date := v_start_date + make_interval(days => v_duration_int);
      WHEN 'week', 'weeks' THEN
        v_end_date := v_start_date + make_interval(days => v_duration_int * 7);
      WHEN 'month', 'months' THEN
        v_end_date := v_start_date + make_interval(months => v_duration_int);
      WHEN 'year', 'years' THEN
        v_end_date := v_start_date + make_interval(years => v_duration_int);
      ELSE
        v_end_date := NULL;
    END CASE;
  END IF;

  -- Parse selected_week_days to DOW ints (0=Sun ... 6=Sat). Supports ints and names.
  IF jsonb_typeof(v_job.selected_week_days) = 'array' THEN
    FOR v_weekday_item IN
      SELECT jsonb_array_elements_text(v_job.selected_week_days)
    LOOP
      BEGIN
        v_weekdays := array_append(v_weekdays, trim(v_weekday_item)::int);
      EXCEPTION
        WHEN others THEN
          CASE lower(trim(v_weekday_item))
            WHEN 'sun', 'sunday' THEN v_weekdays := array_append(v_weekdays, 0);
            WHEN 'mon', 'monday' THEN v_weekdays := array_append(v_weekdays, 1);
            WHEN 'tue', 'tues', 'tuesday' THEN v_weekdays := array_append(v_weekdays, 2);
            WHEN 'wed', 'wednesday' THEN v_weekdays := array_append(v_weekdays, 3);
            WHEN 'thu', 'thur', 'thurs', 'thursday' THEN v_weekdays := array_append(v_weekdays, 4);
            WHEN 'fri', 'friday' THEN v_weekdays := array_append(v_weekdays, 5);
            WHEN 'sat', 'saturday' THEN v_weekdays := array_append(v_weekdays, 6);
            ELSE NULL;
          END CASE;
      END;
    END LOOP;
  END IF;
  SELECT array_agg(DISTINCT d ORDER BY d) INTO v_weekdays
  FROM unnest(v_weekdays) d
  WHERE d BETWEEN 0 AND 6;

  -- Base appointment is already synced by job_id; generate FUTURE occurrences only.
  v_cursor := v_start_date + 1;

  WHILE v_created < v_target LOOP
    v_upper_guard := v_upper_guard + 1;
    IF v_upper_guard > 3660 THEN
      EXIT;
    END IF;

    IF v_end_date IS NOT NULL AND v_cursor > v_end_date THEN
      EXIT;
    END IF;

    v_should_insert := false;

    IF v_frequency = 'daily' THEN
      v_should_insert := true;
    ELSIF v_frequency = 'weekly' THEN
      IF coalesce(array_length(v_weekdays, 1), 0) > 0 THEN
        v_should_insert := extract(dow from v_cursor)::int = ANY (v_weekdays);
      ELSE
        v_should_insert := ((v_cursor - v_start_date) % 7 = 0);
      END IF;
    ELSIF v_frequency = 'biweekly' THEN
      IF coalesce(array_length(v_weekdays, 1), 0) > 0 THEN
        v_should_insert := extract(dow from v_cursor)::int = ANY (v_weekdays)
          AND (((v_cursor - v_start_date) / 7) % 2 = 0);
      ELSE
        v_should_insert := ((v_cursor - v_start_date) % 14 = 0);
      END IF;
    ELSIF v_frequency = 'monthly' THEN
      v_should_insert := extract(day from v_cursor) = extract(day from v_start_date);
    END IF;

    IF v_should_insert THEN
      INSERT INTO public.route_appointments (
        user_id,
        route_id,
        client_id,
        job_id,
        source_job_id,
        scheduled_date,
        scheduled_time,
        end_time,
        notes,
        status,
        service_type,
        assigned_employees,
        deposit_required,
        deposit_amount,
        recurring_frequency,
        recurring_duration,
        recurring_duration_unit,
        selected_week_days
      )
      VALUES (
        v_job.user_id,
        v_route_id,
        v_job.client_id,
        NULL,
        p_job_id,
        v_cursor,
        v_job.start_time,
        v_job.end_time,
        v_job.internal_notes,
        'scheduled',
        v_job.service_type,
        COALESCE(v_job.assigned_employees, '[]'::jsonb),
        CASE WHEN COALESCE(v_job.deposit_required, false) THEN 'yes' ELSE 'no' END,
        v_job.deposit_amount,
        v_job.recurring_frequency,
        v_job.recurring_duration,
        v_job.recurring_duration_unit,
        COALESCE(v_job.selected_week_days, '[]'::jsonb)
      )
      ON CONFLICT (source_job_id, scheduled_date, scheduled_time) DO UPDATE
      SET
        route_id = EXCLUDED.route_id,
        client_id = EXCLUDED.client_id,
        end_time = EXCLUDED.end_time,
        notes = EXCLUDED.notes,
        status = EXCLUDED.status,
        service_type = EXCLUDED.service_type,
        assigned_employees = EXCLUDED.assigned_employees,
        deposit_required = EXCLUDED.deposit_required,
        deposit_amount = EXCLUDED.deposit_amount,
        recurring_frequency = EXCLUDED.recurring_frequency,
        recurring_duration = EXCLUDED.recurring_duration,
        recurring_duration_unit = EXCLUDED.recurring_duration_unit,
        selected_week_days = EXCLUDED.selected_week_days;

      v_created := v_created + 1;
    END IF;

    v_cursor := v_cursor + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'job_id', p_job_id,
    'frequency', v_frequency,
    'created_or_updated', v_created,
    'deleted_future_before_regenerate', v_deleted,
    'start_date', v_start_date,
    'end_date', v_end_date,
    'occurrences_requested', v_target
  );
END;
$$;

COMMENT ON FUNCTION public.generate_job_recurring_appointments (uuid, integer, boolean) IS
  'Generates/updates future route_appointments from a recurring job without cron. Base synced appointment remains linked by job_id.';

GRANT EXECUTE ON FUNCTION public.generate_job_recurring_appointments (uuid, integer, boolean) TO authenticated;
