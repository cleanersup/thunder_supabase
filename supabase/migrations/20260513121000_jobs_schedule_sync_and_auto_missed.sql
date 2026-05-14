-- Jobs <-> Schedule sync + auto-miss overdue jobs
-- Keeps route_appointments in sync from jobs and marks overdue jobs as missed after 6h.

-- 1) Missing linkage properties for schedule sync
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS route_id uuid REFERENCES public.routes(id) ON DELETE SET NULL;

ALTER TABLE public.route_appointments
  ADD COLUMN IF NOT EXISTS job_id uuid REFERENCES public.jobs(id) ON DELETE CASCADE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'route_appointments_job_id_key'
      AND conrelid = 'public.route_appointments'::regclass
  ) THEN
    ALTER TABLE public.route_appointments
      ADD CONSTRAINT route_appointments_job_id_key UNIQUE (job_id);
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_jobs_route_id
ON public.jobs(route_id)
WHERE route_id IS NOT NULL;

COMMENT ON COLUMN public.jobs.route_id IS
  'Optional route selected for schedule sync; if null, backend auto-selects/creates a route.';

COMMENT ON COLUMN public.route_appointments.job_id IS
  'Back-reference to jobs for backend schedule sync (one schedule row per job).';

-- 2) Helper: pick/validate route for job schedule sync
CREATE OR REPLACE FUNCTION public.resolve_job_route_id (
  p_user_id uuid,
  p_route_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_route_id uuid;
BEGIN
  IF p_route_id IS NOT NULL THEN
    SELECT r.id
    INTO v_route_id
    FROM public.routes r
    WHERE r.id = p_route_id
      AND r.user_id = p_user_id
    LIMIT 1;

    IF v_route_id IS NOT NULL THEN
      RETURN v_route_id;
    END IF;
  END IF;

  SELECT r.id
  INTO v_route_id
  FROM public.routes r
  WHERE r.user_id = p_user_id
  ORDER BY r.created_at ASC
  LIMIT 1;

  IF v_route_id IS NOT NULL THEN
    RETURN v_route_id;
  END IF;

  INSERT INTO public.routes (user_id, name)
  VALUES (p_user_id, 'Jobs Auto Route')
  RETURNING id INTO v_route_id;

  RETURN v_route_id;
END;
$$;

COMMENT ON FUNCTION public.resolve_job_route_id (uuid, uuid) IS
  'Returns a valid route for a job owner. Uses provided route when valid, otherwise first user route, otherwise creates Jobs Auto Route.';

-- 3) Helper: compute UTC scheduled start from user timezone
CREATE OR REPLACE FUNCTION public.job_scheduled_start_at (
  p_user_id uuid,
  p_scheduled_date date,
  p_start_time time without time zone
)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_timezone text := 'America/New_York';
BEGIN
  IF p_scheduled_date IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(NULLIF(p.timezone, ''), 'America/New_York')
  INTO v_timezone
  FROM public.profiles p
  WHERE p.user_id = p_user_id
  LIMIT 1;

  RETURN (
    (p_scheduled_date::text || ' ' || COALESCE(p_start_time, '00:00'::time)::text)::timestamp
    AT TIME ZONE v_timezone
  );
END;
$$;

COMMENT ON FUNCTION public.job_scheduled_start_at (uuid, date, time without time zone) IS
  'Converts job local scheduled_date/start_time (owner timezone) to UTC timestamptz. Null start_time defaults to 00:00.';

-- 4) Replace temporal derivation to support 6-hour overdue rule
CREATE OR REPLACE FUNCTION public.derive_job_temporal_status (
  p_scheduled_date date,
  p_start_time time without time zone DEFAULT NULL,
  p_user_id uuid DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_start_at timestamptz;
BEGIN
  IF p_scheduled_date IS NULL THEN
    RETURN 'draft';
  END IF;

  v_start_at := public.job_scheduled_start_at(p_user_id, p_scheduled_date, p_start_time);

  IF v_start_at IS NOT NULL AND v_start_at <= now() - interval '6 hours' THEN
    RETURN 'missed';
  END IF;

  IF p_scheduled_date > CURRENT_DATE THEN
    RETURN 'upcoming';
  ELSIF p_scheduled_date = CURRENT_DATE THEN
    RETURN 'today';
  END IF;

  RETURN 'missed';
END;
$$;

COMMENT ON FUNCTION public.derive_job_temporal_status (date, time without time zone, uuid) IS
  'Returns upcoming/today/missed using owner timezone and 6-hour overdue threshold.';

-- Keep older 1-arg callsites compatible.
CREATE OR REPLACE FUNCTION public.derive_job_temporal_status (p_date date)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
BEGIN
  RETURN public.derive_job_temporal_status(p_date, NULL, NULL);
END;
$$;

-- 5) Normalize status with time-aware temporal derivation
CREATE OR REPLACE FUNCTION public.normalize_job_status ()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.status := lower(COALESCE(NULLIF(trim(NEW.status), ''), 'draft'));
  IF NEW.status = 'canceled' THEN
    NEW.status := 'cancelled';
  END IF;

  IF NEW.status IN ('upcoming', 'today', 'missed') THEN
    NEW.status := public.derive_job_temporal_status(NEW.scheduled_date, NEW.start_time, NEW.user_id);
  END IF;

  RETURN NEW;
END;
$$;

-- 6) Refresh helper with new temporal function
CREATE OR REPLACE FUNCTION public.refresh_job_temporal_statuses ()
RETURNS integer
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_rows integer;
BEGIN
  UPDATE public.jobs j
  SET status = public.derive_job_temporal_status(j.scheduled_date, j.start_time, j.user_id)
  WHERE j.status IN ('upcoming', 'today', 'missed');

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$;

-- 7) Sync jobs -> route_appointments on insert/update
CREATE OR REPLACE FUNCTION public.sync_job_to_route_appointment ()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_route_id uuid;
BEGIN
  -- No client = no schedule row
  IF NEW.client_id IS NULL THEN
    DELETE FROM public.route_appointments ra
    WHERE ra.job_id = NEW.id;
    RETURN NEW;
  END IF;

  v_route_id := public.resolve_job_route_id(NEW.user_id, NEW.route_id);

  INSERT INTO public.route_appointments (
    user_id,
    route_id,
    client_id,
    job_id,
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
    NEW.user_id,
    v_route_id,
    NEW.client_id,
    NEW.id,
    NEW.scheduled_date,
    NEW.start_time,
    NEW.end_time,
    NEW.internal_notes,
    NEW.status,
    NEW.service_type,
    COALESCE(NEW.assigned_employees, '[]'::jsonb),
    CASE WHEN COALESCE(NEW.deposit_required, false) THEN 'yes' ELSE 'no' END,
    NEW.deposit_amount,
    NEW.recurring_frequency,
    NEW.recurring_duration,
    NEW.recurring_duration_unit,
    COALESCE(NEW.selected_week_days, '[]'::jsonb)
  )
  ON CONFLICT (job_id) DO UPDATE
  SET
    route_id = EXCLUDED.route_id,
    client_id = EXCLUDED.client_id,
    scheduled_date = EXCLUDED.scheduled_date,
    scheduled_time = EXCLUDED.scheduled_time,
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

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_sync_job_to_route_appointment ON public.jobs;
CREATE TRIGGER tr_sync_job_to_route_appointment
  AFTER INSERT OR UPDATE OF
    route_id,
    client_id,
    scheduled_date,
    start_time,
    end_time,
    internal_notes,
    status,
    service_type,
    assigned_employees,
    deposit_required,
    deposit_amount,
    recurring_frequency,
    recurring_duration,
    recurring_duration_unit,
    selected_week_days
  ON public.jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_job_to_route_appointment ();

COMMENT ON FUNCTION public.sync_job_to_route_appointment () IS
  'Keeps route_appointments row in sync with jobs for create/edit operations.';

-- 8) Overdue sweeper (6 hours after scheduled start)
CREATE OR REPLACE FUNCTION public.mark_overdue_jobs_missed ()
RETURNS integer
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_rows integer;
BEGIN
  UPDATE public.jobs j
  SET status = 'missed'
  WHERE j.status IN ('draft', 'upcoming', 'today')
    AND public.job_scheduled_start_at(j.user_id, j.scheduled_date, j.start_time) <= now() - interval '6 hours';

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$;

COMMENT ON FUNCTION public.mark_overdue_jobs_missed () IS
  'Marks jobs as missed when scheduled start is overdue by 6h and status is not started/completed/cancelled.';

-- 9) Cron for auto-miss overdue jobs (hourly)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule('mark-overdue-jobs-missed-hourly');
    EXCEPTION
      WHEN others THEN
        NULL;
    END;

    PERFORM cron.schedule(
      'mark-overdue-jobs-missed-hourly',
      '0 * * * *',
      'SELECT public.mark_overdue_jobs_missed();'
    );
  END IF;
END;
$$;
