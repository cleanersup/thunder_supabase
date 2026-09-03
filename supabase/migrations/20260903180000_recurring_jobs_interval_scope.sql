-- Recurring jobs: interval + end date + scoped edit/delete/cancel.
-- Additive and backward compatible:
--   * old duration columns stay
--   * every_two_weeks still accepted (mapped to weekly + interval 2)
--   * existing series are NOT regenerated
--   * cancel_recurring_job_series(uuid) remains as a wrapper for scope=all

-- ---------------------------------------------------------------------------
-- 1) Columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS recurring_interval integer,
  ADD COLUMN IF NOT EXISTS recurring_end_date date;

ALTER TABLE public.jobs
  DROP CONSTRAINT IF EXISTS jobs_recurring_interval_check;

ALTER TABLE public.jobs
  ADD CONSTRAINT jobs_recurring_interval_check
  CHECK (recurring_interval IS NULL OR recurring_interval >= 1);

COMMENT ON COLUMN public.jobs.recurring_interval IS
  'Repeat every N units of recurring_frequency (days/weeks/months). NULL means 1, except legacy every_two_weeks => 2.';

COMMENT ON COLUMN public.jobs.recurring_end_date IS
  'Last calendar day an occurrence may fall (inclusive). NULL falls back to recurring_duration or 12 children.';

ALTER TABLE public.route_appointments
  ADD COLUMN IF NOT EXISTS recurring_interval integer,
  ADD COLUMN IF NOT EXISTS recurring_end_date date;

-- Legacy "every two weeks" => weekly + 2. Do not regenerate children.
UPDATE public.jobs
SET
  recurring_frequency = 'weekly',
  recurring_interval = COALESCE(recurring_interval, 2)
WHERE regexp_replace(lower(coalesce(recurring_frequency, '')), '[^a-z0-9]+', '', 'g')
      IN ('everytwoweeks', 'every2weeks', 'biweekly', 'fortnightly');

UPDATE public.route_appointments
SET
  recurring_frequency = 'weekly',
  recurring_interval = COALESCE(recurring_interval, 2)
WHERE regexp_replace(lower(coalesce(recurring_frequency, '')), '[^a-z0-9]+', '', 'g')
      IN ('everytwoweeks', 'every2weeks', 'biweekly', 'fortnightly');

-- ---------------------------------------------------------------------------
-- 2) Frequency helper: keep legacy labels, expose canonical daily|weekly|monthly
-- ---------------------------------------------------------------------------
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
    RETURN 'every_two_weeks';
  ELSIF v_norm IN ('monthly', 'everymonth') THEN
    RETURN 'monthly';
  END IF;

  RETURN '';
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_job_recurring_interval (
  p_frequency text,
  p_interval integer
)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
BEGIN
  IF p_interval IS NOT NULL AND p_interval >= 1 THEN
    RETURN p_interval;
  END IF;
  IF public.normalize_job_recurring_frequency(p_frequency) = 'every_two_weeks' THEN
    RETURN 2;
  END IF;
  RETURN 1;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3) Occurrence dates (parent date included; caller skips the parent row)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recurring_job_occurrence_dates (
  p_start_date date,
  p_frequency text,
  p_interval integer,
  p_weekdays integer[],
  p_end_date date,
  p_max_count integer DEFAULT 500
)
RETURNS SETOF date
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_frequency text;
  v_interval integer;
  v_weekdays integer[] := COALESCE(p_weekdays, ARRAY[]::integer[]);
  v_max integer := GREATEST(COALESCE(p_max_count, 500), 1);
  v_count integer := 0;
  v_step integer := 0;
  v_date date;
  v_week_start date;
  v_wd integer;
  v_guard integer := 0;
BEGIN
  IF p_start_date IS NULL THEN
    RETURN;
  END IF;

  v_frequency := public.normalize_job_recurring_frequency(p_frequency);
  IF v_frequency = 'every_two_weeks' THEN
    v_frequency := 'weekly';
  END IF;
  IF v_frequency NOT IN ('daily', 'weekly', 'monthly') THEN
    RETURN;
  END IF;

  v_interval := public.resolve_job_recurring_interval(p_frequency, p_interval);

  IF v_frequency = 'weekly' AND coalesce(array_length(v_weekdays, 1), 0) = 0 THEN
    v_weekdays := ARRAY[extract(dow from p_start_date)::int];
  END IF;

  IF v_frequency = 'weekly' THEN
    SELECT array_agg(DISTINCT d ORDER BY d)
    INTO v_weekdays
    FROM unnest(v_weekdays) d
    WHERE d BETWEEN 0 AND 6;
  END IF;

  IF v_frequency = 'daily' THEN
    WHILE v_count < v_max LOOP
      v_date := p_start_date + (v_step * v_interval);
      IF p_end_date IS NOT NULL AND v_date > p_end_date THEN
        EXIT;
      END IF;
      RETURN NEXT v_date;
      v_count := v_count + 1;
      v_step := v_step + 1;
    END LOOP;
    RETURN;
  END IF;

  IF v_frequency = 'monthly' THEN
    WHILE v_count < v_max LOOP
      v_date := (p_start_date + make_interval(months => v_step * v_interval))::date;
      IF p_end_date IS NOT NULL AND v_date > p_end_date THEN
        EXIT;
      END IF;
      RETURN NEXT v_date;
      v_count := v_count + 1;
      v_step := v_step + 1;
    END LOOP;
    RETURN;
  END IF;

  -- weekly: step N weeks from the week that contains start_date (Sunday = 0)
  v_week_start := p_start_date - extract(dow from p_start_date)::int;
  WHILE v_count < v_max LOOP
    v_guard := v_guard + 1;
    IF v_guard > 4000 THEN
      EXIT;
    END IF;

    IF p_end_date IS NOT NULL AND v_week_start > p_end_date THEN
      EXIT;
    END IF;

    FOREACH v_wd IN ARRAY v_weekdays LOOP
      v_date := v_week_start + v_wd;
      IF v_date >= p_start_date
         AND (p_end_date IS NULL OR v_date <= p_end_date)
         AND v_count < v_max THEN
        RETURN NEXT v_date;
        v_count := v_count + 1;
      END IF;
    END LOOP;

    v_week_start := v_week_start + (v_interval * 7);
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.recurring_job_occurrence_dates (date, text, integer, integer[], date, integer) IS
  'Canonical occurrence dates for daily/weekly/monthly with interval N. End date is inclusive.';

-- ---------------------------------------------------------------------------
-- 4) Weekday parser (0-6 or sunday..saturday)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.parse_job_weekdays (p_days jsonb)
RETURNS integer[]
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_weekdays integer[] := ARRAY[]::integer[];
  v_item text;
BEGIN
  IF jsonb_typeof(p_days) IS DISTINCT FROM 'array' THEN
    RETURN ARRAY[]::integer[];
  END IF;

  FOR v_item IN SELECT jsonb_array_elements_text(p_days)
  LOOP
    BEGIN
      v_weekdays := array_append(v_weekdays, trim(v_item)::int);
    EXCEPTION
      WHEN others THEN
        CASE lower(trim(v_item))
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

  SELECT coalesce(array_agg(DISTINCT d ORDER BY d), ARRAY[]::integer[])
  INTO v_weekdays
  FROM unnest(v_weekdays) d
  WHERE d BETWEEN 0 AND 6;

  RETURN v_weekdays;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5) End-date resolution: new column, then legacy duration, else 12 children
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_recurring_job_end_date (
  p_start_date date,
  p_end_date date,
  p_duration text,
  p_duration_unit text
)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_duration_int integer;
BEGIN
  IF p_end_date IS NOT NULL THEN
    RETURN p_end_date;
  END IF;

  BEGIN
    v_duration_int := NULLIF(trim(coalesce(p_duration, '')), '')::integer;
  EXCEPTION
    WHEN others THEN
      v_duration_int := NULL;
  END;

  IF v_duration_int IS NULL OR v_duration_int <= 0 OR p_start_date IS NULL THEN
    RETURN NULL;
  END IF;

  CASE lower(coalesce(p_duration_unit, 'months'))
    WHEN 'day', 'days' THEN
      RETURN p_start_date + make_interval(days => v_duration_int);
    WHEN 'week', 'weeks' THEN
      RETURN p_start_date + make_interval(days => v_duration_int * 7);
    WHEN 'month', 'months' THEN
      RETURN p_start_date + make_interval(months => v_duration_int);
    WHEN 'year', 'years' THEN
      RETURN p_start_date + make_interval(years => v_duration_int);
    ELSE
      RETURN NULL;
  END CASE;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6) Generator (same 2-arg callers + optional p_from_date)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.generate_recurring_job_instances (uuid, boolean);

CREATE OR REPLACE FUNCTION public.generate_recurring_job_instances (
  p_job_id uuid,
  p_replace_future boolean DEFAULT true,
  p_from_date date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_job public.jobs%ROWTYPE;
  v_frequency text;
  v_interval integer;
  v_start_date date;
  v_from_date date;
  v_end_date date;
  v_weekdays integer[];
  v_occ date;
  v_created integer := 0;
  v_deleted integer := 0;
  v_max_count integer := 12;
BEGIN
  SELECT *
  INTO v_job
  FROM public.jobs
  WHERE id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job not found';
  END IF;

  IF v_uid IS NOT NULL AND v_job.user_id <> v_uid THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;

  IF v_job.parent_job_id IS NOT NULL THEN
    RAISE EXCEPTION 'Job % is not a recurring series parent', p_job_id;
  END IF;

  IF v_job.job_type <> 'recurring' THEN
    RAISE EXCEPTION 'Job % is not recurring', p_job_id;
  END IF;

  IF v_job.client_id IS NULL AND v_job.lead_id IS NULL THEN
    RAISE EXCEPTION 'Recurring jobs require client_id or lead_id to generate instances';
  END IF;

  IF v_job.status = 'completed' THEN
    RAISE EXCEPTION 'Cannot generate recurring instances for completed jobs';
  END IF;

  v_frequency := public.normalize_job_recurring_frequency(v_job.recurring_frequency);
  IF v_frequency = '' THEN
    RAISE EXCEPTION 'Unsupported recurring_frequency: %', coalesce(v_job.recurring_frequency, 'null');
  END IF;

  v_interval := public.resolve_job_recurring_interval(v_job.recurring_frequency, v_job.recurring_interval);
  v_start_date := v_job.scheduled_date;
  v_from_date := COALESCE(p_from_date, v_start_date);
  v_weekdays := public.parse_job_weekdays(v_job.selected_week_days);
  v_end_date := public.resolve_recurring_job_end_date(
    v_start_date,
    v_job.recurring_end_date,
    v_job.recurring_duration,
    v_job.recurring_duration_unit
  );

  IF v_end_date IS NOT NULL THEN
    v_max_count := 3660;
  END IF;

  IF p_replace_future THEN
    -- Publish (no p_from_date): only wipe still-scheduled children, same as before.
    -- Scoped pattern regen: also replace upcoming/today/missed/draft from that date.
    DELETE FROM public.jobs child
    WHERE child.parent_job_id = p_job_id
      AND child.scheduled_date >= v_from_date
      AND child.scheduled_date > v_start_date
      AND (
        (p_from_date IS NULL AND child.status = 'scheduled')
        OR (
          p_from_date IS NOT NULL
          AND child.status IN ('scheduled', 'upcoming', 'today', 'missed', 'draft')
        )
      );
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
  END IF;

  FOR v_occ IN
    SELECT public.recurring_job_occurrence_dates(
      v_start_date,
      v_job.recurring_frequency,
      v_interval,
      v_weekdays,
      v_end_date,
      v_max_count
    )
  LOOP
    IF v_occ <= v_start_date THEN
      CONTINUE;
    END IF;
    IF v_occ < v_from_date THEN
      CONTINUE;
    END IF;

    INSERT INTO public.jobs (
      user_id,
      client_id,
      lead_id,
      contact_type,
      client_name,
      client_email,
      client_phone,
      property_street,
      property_apt,
      property_city,
      property_state,
      property_zip,
      site_latitude,
      site_longitude,
      geofence_radius_meters,
      assigned_employees,
      service_type,
      job_type,
      recurring_frequency,
      recurring_duration,
      recurring_duration_unit,
      recurring_interval,
      recurring_end_date,
      selected_week_days,
      scheduled_date,
      start_time,
      end_time,
      line_items,
      service_details,
      internal_notes,
      subtotal,
      discount_type,
      discount_value,
      tax_type,
      tax_value,
      deposit_required,
      deposit_type,
      deposit_value,
      amount_paid,
      payment_status,
      status,
      route_id,
      parent_job_id,
      estimate_id,
      walkthrough_id,
      deposit_invoice_id,
      invoice_ids
    )
    VALUES (
      v_job.user_id,
      v_job.client_id,
      v_job.lead_id,
      v_job.contact_type,
      v_job.client_name,
      v_job.client_email,
      v_job.client_phone,
      v_job.property_street,
      v_job.property_apt,
      v_job.property_city,
      v_job.property_state,
      v_job.property_zip,
      v_job.site_latitude,
      v_job.site_longitude,
      COALESCE(v_job.geofence_radius_meters, 200),
      COALESCE(v_job.assigned_employees, '[]'::jsonb),
      v_job.service_type,
      'one_time',
      NULL,
      NULL,
      NULL,
      NULL,
      NULL,
      '[]'::jsonb,
      v_occ,
      v_job.start_time,
      v_job.end_time,
      v_job.line_items,
      v_job.service_details,
      v_job.internal_notes,
      v_job.subtotal,
      v_job.discount_type,
      v_job.discount_value,
      v_job.tax_type,
      v_job.tax_value,
      false,
      v_job.deposit_type,
      0,
      0,
      'no_deposit_required',
      'scheduled',
      v_job.route_id,
      p_job_id,
      NULL,
      NULL,
      NULL,
      '{}'::uuid[]
    )
    ON CONFLICT (parent_job_id, scheduled_date) WHERE parent_job_id IS NOT NULL
    DO UPDATE SET
      client_id = EXCLUDED.client_id,
      lead_id = EXCLUDED.lead_id,
      contact_type = EXCLUDED.contact_type,
      client_name = EXCLUDED.client_name,
      client_email = EXCLUDED.client_email,
      client_phone = EXCLUDED.client_phone,
      property_street = EXCLUDED.property_street,
      property_apt = EXCLUDED.property_apt,
      property_city = EXCLUDED.property_city,
      property_state = EXCLUDED.property_state,
      property_zip = EXCLUDED.property_zip,
      site_latitude = EXCLUDED.site_latitude,
      site_longitude = EXCLUDED.site_longitude,
      geofence_radius_meters = EXCLUDED.geofence_radius_meters,
      assigned_employees = EXCLUDED.assigned_employees,
      service_type = EXCLUDED.service_type,
      start_time = EXCLUDED.start_time,
      end_time = EXCLUDED.end_time,
      line_items = EXCLUDED.line_items,
      service_details = EXCLUDED.service_details,
      internal_notes = EXCLUDED.internal_notes,
      subtotal = EXCLUDED.subtotal,
      discount_type = EXCLUDED.discount_type,
      discount_value = EXCLUDED.discount_value,
      tax_type = EXCLUDED.tax_type,
      tax_value = EXCLUDED.tax_value,
      route_id = EXCLUDED.route_id,
      status = CASE
        WHEN public.jobs.status IN ('ongoing', 'completed', 'cancelled') THEN public.jobs.status
        ELSE 'scheduled'
      END;

    v_created := v_created + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'job_id', p_job_id,
    'frequency', CASE WHEN v_frequency = 'every_two_weeks' THEN 'weekly' ELSE v_frequency END,
    'interval', v_interval,
    'created_or_updated', v_created,
    'deleted_future_before_regenerate', v_deleted,
    'start_date', v_start_date,
    'from_date', v_from_date,
    'end_date', v_end_date
  );
END;
$$;

COMMENT ON FUNCTION public.generate_recurring_job_instances (uuid, boolean, date) IS
  'Creates future child jobs for a recurring parent. p_from_date limits replace/create to that date onward. Children never get deposit_required.';

GRANT EXECUTE ON FUNCTION public.generate_recurring_job_instances (uuid, boolean, date) TO authenticated;

-- ---------------------------------------------------------------------------
-- 7) Invoice cleanup before hard delete
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cleanup_invoices_for_deleted_jobs (p_job_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  IF p_job_ids IS NULL OR array_length(p_job_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  UPDATE public.invoices i
  SET status = 'Cancelled'
  WHERE i.status IN ('Draft', 'Pending')
    AND i.id IN (
      SELECT j.deposit_invoice_id
      FROM public.jobs j
      WHERE j.id = ANY (p_job_ids)
        AND j.deposit_invoice_id IS NOT NULL
      UNION
      SELECT unnest(j.invoice_ids)
      FROM public.jobs j
      WHERE j.id = ANY (p_job_ids)
    );

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- ---------------------------------------------------------------------------
-- 8) Safe payload apply (whitelist only)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_job_update_payload (
  p_job_ids uuid[],
  p_payload jsonb,
  p_apply_pattern boolean DEFAULT false
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  IF p_job_ids IS NULL OR array_length(p_job_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  UPDATE public.jobs j
  SET
    start_time = CASE
      WHEN p_payload ? 'start_time' THEN NULLIF(p_payload->>'start_time', '')::time
      ELSE j.start_time
    END,
    end_time = CASE
      WHEN p_payload ? 'end_time' THEN NULLIF(p_payload->>'end_time', '')::time
      ELSE j.end_time
    END,
    assigned_employees = CASE
      WHEN p_payload ? 'assigned_employees' THEN COALESCE(p_payload->'assigned_employees', '[]'::jsonb)
      ELSE j.assigned_employees
    END,
    service_type = CASE
      WHEN p_payload ? 'service_type' THEN p_payload->>'service_type'
      ELSE j.service_type
    END,
    service_details = CASE
      WHEN p_payload ? 'service_details' THEN p_payload->>'service_details'
      ELSE j.service_details
    END,
    internal_notes = CASE
      WHEN p_payload ? 'internal_notes' THEN p_payload->>'internal_notes'
      ELSE j.internal_notes
    END,
    line_items = CASE
      WHEN p_payload ? 'line_items' THEN COALESCE(p_payload->'line_items', '[]'::jsonb)
      ELSE j.line_items
    END,
    client_id = CASE
      WHEN p_payload ? 'client_id' THEN NULLIF(p_payload->>'client_id', '')::uuid
      ELSE j.client_id
    END,
    lead_id = CASE
      WHEN p_payload ? 'lead_id' THEN NULLIF(p_payload->>'lead_id', '')::uuid
      ELSE j.lead_id
    END,
    contact_type = CASE
      WHEN p_payload ? 'contact_type' THEN p_payload->>'contact_type'
      ELSE j.contact_type
    END,
    client_name = CASE
      WHEN p_payload ? 'client_name' THEN p_payload->>'client_name'
      ELSE j.client_name
    END,
    client_email = CASE
      WHEN p_payload ? 'client_email' THEN p_payload->>'client_email'
      ELSE j.client_email
    END,
    client_phone = CASE
      WHEN p_payload ? 'client_phone' THEN p_payload->>'client_phone'
      ELSE j.client_phone
    END,
    property_street = CASE
      WHEN p_payload ? 'property_street' THEN p_payload->>'property_street'
      ELSE j.property_street
    END,
    property_apt = CASE
      WHEN p_payload ? 'property_apt' THEN p_payload->>'property_apt'
      ELSE j.property_apt
    END,
    property_city = CASE
      WHEN p_payload ? 'property_city' THEN p_payload->>'property_city'
      ELSE j.property_city
    END,
    property_state = CASE
      WHEN p_payload ? 'property_state' THEN p_payload->>'property_state'
      ELSE j.property_state
    END,
    property_zip = CASE
      WHEN p_payload ? 'property_zip' THEN p_payload->>'property_zip'
      ELSE j.property_zip
    END,
    site_latitude = CASE
      WHEN p_payload ? 'site_latitude' THEN NULLIF(p_payload->>'site_latitude', '')::numeric
      ELSE j.site_latitude
    END,
    site_longitude = CASE
      WHEN p_payload ? 'site_longitude' THEN NULLIF(p_payload->>'site_longitude', '')::numeric
      ELSE j.site_longitude
    END,
    geofence_radius_meters = CASE
      WHEN p_payload ? 'geofence_radius_meters' THEN NULLIF(p_payload->>'geofence_radius_meters', '')::integer
      ELSE j.geofence_radius_meters
    END,
    route_id = CASE
      WHEN p_payload ? 'route_id' THEN NULLIF(p_payload->>'route_id', '')::uuid
      ELSE j.route_id
    END,
    subtotal = CASE
      WHEN p_payload ? 'subtotal' THEN COALESCE(NULLIF(p_payload->>'subtotal', '')::numeric, j.subtotal)
      ELSE j.subtotal
    END,
    discount_type = CASE
      WHEN p_payload ? 'discount_type' THEN p_payload->>'discount_type'
      ELSE j.discount_type
    END,
    discount_value = CASE
      WHEN p_payload ? 'discount_value' THEN COALESCE(NULLIF(p_payload->>'discount_value', '')::numeric, j.discount_value)
      ELSE j.discount_value
    END,
    tax_type = CASE
      WHEN p_payload ? 'tax_type' THEN p_payload->>'tax_type'
      ELSE j.tax_type
    END,
    tax_value = CASE
      WHEN p_payload ? 'tax_value' THEN COALESCE(NULLIF(p_payload->>'tax_value', '')::numeric, j.tax_value)
      ELSE j.tax_value
    END,
    recurring_frequency = CASE
      WHEN p_apply_pattern AND p_payload ? 'recurring_frequency' THEN p_payload->>'recurring_frequency'
      ELSE j.recurring_frequency
    END,
    recurring_interval = CASE
      WHEN p_apply_pattern AND p_payload ? 'recurring_interval' THEN NULLIF(p_payload->>'recurring_interval', '')::integer
      ELSE j.recurring_interval
    END,
    recurring_end_date = CASE
      WHEN p_apply_pattern AND p_payload ? 'recurring_end_date' THEN NULLIF(p_payload->>'recurring_end_date', '')::date
      ELSE j.recurring_end_date
    END,
    selected_week_days = CASE
      WHEN p_apply_pattern AND p_payload ? 'selected_week_days' THEN COALESCE(p_payload->'selected_week_days', '[]'::jsonb)
      ELSE j.selected_week_days
    END
  WHERE j.id = ANY (p_job_ids);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- ---------------------------------------------------------------------------
-- 9) Scoped manager
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.manage_recurring_job (
  p_job_id uuid,
  p_action text,
  p_scope text,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_job public.jobs%ROWTYPE;
  v_parent public.jobs%ROWTYPE;
  v_action text := lower(trim(coalesce(p_action, '')));
  v_scope text := lower(trim(coalesce(p_scope, '')));
  v_payload jsonb := COALESCE(p_payload, '{}'::jsonb);
  v_is_series boolean;
  v_target_ids uuid[] := ARRAY[]::uuid[];
  v_updated integer := 0;
  v_deleted integer := 0;
  v_cancelled integer := 0;
  v_invoices integer := 0;
  v_regen jsonb := NULL;
  v_pattern_change boolean := false;
  v_from_date date;
  v_new_date date;
  v_previous_status text;
BEGIN
  IF v_action NOT IN ('update', 'delete', 'cancel') THEN
    RAISE EXCEPTION 'Unsupported action: % (use update, delete, cancel)', p_action;
  END IF;

  IF v_scope NOT IN ('this_only', 'this_and_following', 'all') THEN
    RAISE EXCEPTION 'Unsupported scope: % (use this_only, this_and_following, all)', p_scope;
  END IF;

  SELECT *
  INTO v_job
  FROM public.jobs
  WHERE id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job not found';
  END IF;

  IF v_uid IS NOT NULL AND v_job.user_id <> v_uid THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;

  v_is_series := (v_job.job_type = 'recurring' OR v_job.parent_job_id IS NOT NULL);

  IF v_scope IN ('this_and_following', 'all') AND NOT v_is_series THEN
    RAISE EXCEPTION 'Job % is not part of a recurring series', p_job_id;
  END IF;

  IF v_job.parent_job_id IS NOT NULL THEN
    SELECT *
    INTO v_parent
    FROM public.jobs
    WHERE id = v_job.parent_job_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Recurring parent % not found', v_job.parent_job_id;
    END IF;
  ELSE
    v_parent := v_job;
  END IF;

  v_from_date := v_job.scheduled_date;
  v_new_date := NULLIF(v_payload->>'scheduled_date', '')::date;
  v_pattern_change :=
    (v_payload ? 'recurring_frequency')
    OR (v_payload ? 'recurring_interval')
    OR (v_payload ? 'recurring_end_date')
    OR (v_payload ? 'selected_week_days')
    OR (v_payload ? 'scheduled_date');

  IF v_scope = 'this_only' THEN
    v_target_ids := ARRAY[v_job.id];
  ELSIF v_scope = 'this_and_following' THEN
    SELECT coalesce(array_agg(j.id), ARRAY[v_job.id])
    INTO v_target_ids
    FROM public.jobs j
    WHERE j.user_id = v_job.user_id
      AND (
        j.id = v_parent.id
        OR j.parent_job_id = v_parent.id
      )
      AND j.scheduled_date >= v_from_date;
  ELSE
    SELECT coalesce(array_agg(j.id), ARRAY[v_parent.id])
    INTO v_target_ids
    FROM public.jobs j
    WHERE j.user_id = v_job.user_id
      AND (j.id = v_parent.id OR j.parent_job_id = v_parent.id);
  END IF;

  -- UPDATE
  IF v_action = 'update' THEN
    IF v_scope = 'this_only' THEN
      v_updated := public.apply_job_update_payload(ARRAY[v_job.id], v_payload, false);
      IF v_payload ? 'scheduled_date' AND v_new_date IS NOT NULL THEN
        UPDATE public.jobs
        SET scheduled_date = v_new_date
        WHERE id = v_job.id;
      END IF;
    ELSE
      v_updated := public.apply_job_update_payload(v_target_ids, v_payload, false);

      IF v_pattern_change THEN
        PERFORM public.apply_job_update_payload(ARRAY[v_parent.id], v_payload, true);

        IF v_scope = 'all' AND v_new_date IS NOT NULL THEN
          UPDATE public.jobs
          SET scheduled_date = v_new_date
          WHERE id = v_parent.id;
        ELSIF v_scope = 'this_and_following' AND v_new_date IS NOT NULL AND v_job.id <> v_parent.id THEN
          UPDATE public.jobs
          SET scheduled_date = v_new_date
          WHERE id = v_job.id;
        ELSIF v_scope = 'this_and_following' AND v_new_date IS NOT NULL AND v_job.id = v_parent.id THEN
          UPDATE public.jobs
          SET scheduled_date = v_new_date
          WHERE id = v_parent.id;
        END IF;

        v_regen := public.generate_recurring_job_instances(
          v_parent.id,
          true,
          CASE
            WHEN v_scope = 'all' THEN COALESCE(v_new_date, v_parent.scheduled_date)
            ELSE COALESCE(v_new_date, v_from_date)
          END
        );

        -- Regenerated children copy the parent row; re-apply the edit onto the
        -- in-scope dates so time/price/notes changes are not lost.
        IF v_scope = 'this_and_following' THEN
          SELECT coalesce(array_agg(j.id), ARRAY[]::uuid[])
          INTO v_target_ids
          FROM public.jobs j
          WHERE j.user_id = v_job.user_id
            AND (j.id = v_parent.id OR j.parent_job_id = v_parent.id)
            AND j.scheduled_date >= COALESCE(v_new_date, v_from_date);
        ELSE
          SELECT coalesce(array_agg(j.id), ARRAY[]::uuid[])
          INTO v_target_ids
          FROM public.jobs j
          WHERE j.user_id = v_job.user_id
            AND (j.id = v_parent.id OR j.parent_job_id = v_parent.id);
        END IF;

        v_updated := public.apply_job_update_payload(v_target_ids, v_payload, false);
      END IF;
    END IF;

    RETURN jsonb_build_object(
      'ok', true,
      'action', v_action,
      'scope', v_scope,
      'job_id', v_job.id,
      'parent_job_id', v_parent.id,
      'updated', v_updated,
      'regenerated', v_regen
    );
  END IF;

  -- CANCEL
  IF v_action = 'cancel' THEN
    v_previous_status := v_job.status;
    ALTER TABLE public.jobs DISABLE TRIGGER on_job_status_change_send_email;

    BEGIN
      UPDATE public.jobs
      SET status = 'cancelled'
      WHERE id = ANY (v_target_ids)
        AND status IN ('draft', 'scheduled', 'upcoming', 'today', 'missed');

      GET DIAGNOSTICS v_cancelled = ROW_COUNT;

      ALTER TABLE public.jobs ENABLE TRIGGER on_job_status_change_send_email;
    EXCEPTION
      WHEN others THEN
        ALTER TABLE public.jobs ENABLE TRIGGER on_job_status_change_send_email;
        RAISE;
    END;

    IF v_scope = 'all' THEN
      PERFORM public.dispatch_job_status_email(
        v_parent.id,
        v_parent.status,
        'cancelled',
        'UPDATE'
      );
    ELSIF v_cancelled > 0 AND v_previous_status IS DISTINCT FROM 'cancelled' THEN
      PERFORM public.dispatch_job_status_email(
        v_job.id,
        v_previous_status,
        'cancelled',
        'UPDATE'
      );
    END IF;

    RETURN jsonb_build_object(
      'ok', true,
      'action', v_action,
      'scope', v_scope,
      'job_id', v_job.id,
      'parent_job_id', v_parent.id,
      'cancelled', v_cancelled
    );
  END IF;

  -- DELETE
  -- Parent + this_only must detach children first (FK is ON DELETE CASCADE).
  IF v_scope = 'this_only' AND v_job.id = v_parent.id AND v_is_series THEN
    UPDATE public.jobs
    SET parent_job_id = NULL
    WHERE parent_job_id = v_parent.id;
  END IF;

  v_invoices := public.cleanup_invoices_for_deleted_jobs(v_target_ids);

  DELETE FROM public.jobs
  WHERE id = ANY (v_target_ids);

  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'action', v_action,
    'scope', v_scope,
    'job_id', p_job_id,
    'parent_job_id', v_parent.id,
    'deleted', v_deleted,
    'invoices_cancelled', v_invoices
  );
END;
$$;

COMMENT ON FUNCTION public.manage_recurring_job (uuid, text, text, jsonb) IS
  'Scoped recurring job operations. action=update|delete|cancel; scope=this_only|this_and_following|all. Payload is used only for update.';

GRANT EXECUTE ON FUNCTION public.manage_recurring_job (uuid, text, text, jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.apply_job_update_payload (uuid[], jsonb, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cleanup_invoices_for_deleted_jobs (uuid[]) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 10) Keep the old cancel RPC as a compatible wrapper
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_recurring_job_series (p_job_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_job public.jobs%ROWTYPE;
  v_parent_id uuid;
  v_previous_status text;
  v_result jsonb;
BEGIN
  SELECT *
  INTO v_job
  FROM public.jobs
  WHERE id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job not found';
  END IF;

  IF v_uid IS NOT NULL AND v_job.user_id <> v_uid THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;

  v_parent_id := COALESCE(v_job.parent_job_id, v_job.id);

  SELECT status
  INTO v_previous_status
  FROM public.jobs
  WHERE id = v_parent_id;

  v_result := public.manage_recurring_job(v_parent_id, 'cancel', 'all', '{}'::jsonb);

  RETURN jsonb_build_object(
    'job_id', v_parent_id,
    'children_cancelled', COALESCE((v_result->>'cancelled')::integer, 0),
    'parent_cancelled', true,
    'previous_status', v_previous_status
  );
END;
$$;

COMMENT ON FUNCTION public.cancel_recurring_job_series (uuid) IS
  'Backward-compatible wrapper: cancels the whole series (parent + cancellable children). Accepts parent or child id.';

GRANT EXECUTE ON FUNCTION public.cancel_recurring_job_series (uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 11) Mirror new recurring fields onto schedule rows
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_job_to_route_appointment ()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_route_id uuid;
  v_appointment_status text;
BEGIN
  IF NEW.client_id IS NULL THEN
    DELETE FROM public.route_appointments ra
    WHERE ra.job_id = NEW.id;
    RETURN NEW;
  END IF;

  v_route_id := public.resolve_job_route_id(NEW.user_id, NEW.route_id);
  v_appointment_status := CASE
    WHEN NEW.job_type = 'recurring' THEN 'scheduled'
    ELSE NEW.status
  END;

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
    recurring_interval,
    recurring_end_date,
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
    v_appointment_status,
    NEW.service_type,
    COALESCE(NEW.assigned_employees, '[]'::jsonb),
    CASE WHEN COALESCE(NEW.deposit_required, false) THEN 'yes' ELSE 'no' END,
    NEW.deposit_amount,
    NEW.recurring_frequency,
    NEW.recurring_duration,
    NEW.recurring_duration_unit,
    NEW.recurring_interval,
    NEW.recurring_end_date,
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
    recurring_interval = EXCLUDED.recurring_interval,
    recurring_end_date = EXCLUDED.recurring_end_date,
    selected_week_days = EXCLUDED.selected_week_days;

  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
