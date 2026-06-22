-- Fix job temporal status derivation: compare scheduled_date against the owner's local
-- calendar date instead of CURRENT_DATE (UTC), which misclassified jobs as 'missed'
-- for users in negative UTC offsets after UTC midnight.

CREATE OR REPLACE FUNCTION public.job_owner_local_date(p_user_id uuid DEFAULT NULL)
RETURNS date
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_timezone text := 'America/New_York';
BEGIN
  IF p_user_id IS NOT NULL THEN
    SELECT COALESCE(NULLIF(p.timezone, ''), 'America/New_York')
    INTO v_timezone
    FROM public.profiles p
    WHERE p.user_id = p_user_id
    LIMIT 1;
  END IF;

  RETURN (now() AT TIME ZONE v_timezone)::date;
END;
$$;

COMMENT ON FUNCTION public.job_owner_local_date (uuid) IS
  'Returns the current calendar date in the job owner''s profile timezone (defaults to America/New_York).';

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
  v_today date;
BEGIN
  IF p_scheduled_date IS NULL THEN
    RETURN 'draft';
  END IF;

  v_today := public.job_owner_local_date(p_user_id);

  v_start_at := public.job_scheduled_start_at(p_user_id, p_scheduled_date, p_start_time);

  IF v_start_at IS NOT NULL AND v_start_at <= now() - interval '6 hours' THEN
    RETURN 'missed';
  END IF;

  IF p_scheduled_date > v_today THEN
    RETURN 'upcoming';
  ELSIF p_scheduled_date = v_today THEN
    RETURN 'today';
  END IF;

  RETURN 'missed';
END;
$$;

COMMENT ON FUNCTION public.derive_job_temporal_status (date, time without time zone, uuid) IS
  'Returns upcoming/today/missed using owner local date, timezone-aware start, and 6-hour overdue threshold.';

CREATE OR REPLACE FUNCTION public.normalize_job_status ()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_today date;
BEGIN
  NEW.status := lower(COALESCE(NULLIF(trim(NEW.status), ''), 'draft'));
  IF NEW.status = 'canceled' THEN
    NEW.status := 'cancelled';
  END IF;

  IF NEW.status = 'scheduled' THEN
    v_today := public.job_owner_local_date(NEW.user_id);
    IF NEW.scheduled_date > v_today THEN
      NEW.status := 'scheduled';
    ELSIF NEW.scheduled_date = v_today THEN
      NEW.status := 'upcoming';
    ELSE
      NEW.status := public.derive_job_temporal_status(NEW.scheduled_date, NEW.start_time, NEW.user_id);
    END IF;
  ELSIF NEW.status IN ('upcoming', 'today', 'missed') THEN
    NEW.status := public.derive_job_temporal_status(NEW.scheduled_date, NEW.start_time, NEW.user_id);
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_job_temporal_statuses ()
RETURNS integer
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_rows integer := 0;
  v_batch integer;
BEGIN
  UPDATE public.jobs j
  SET status = 'upcoming'
  WHERE j.status = 'scheduled'
    AND j.scheduled_date = public.job_owner_local_date(j.user_id);
  GET DIAGNOSTICS v_batch = ROW_COUNT;
  v_rows := v_rows + v_batch;

  UPDATE public.jobs j
  SET status = public.derive_job_temporal_status(j.scheduled_date, j.start_time, j.user_id)
  WHERE j.status = 'scheduled'
    AND j.scheduled_date < public.job_owner_local_date(j.user_id);
  GET DIAGNOSTICS v_batch = ROW_COUNT;
  v_rows := v_rows + v_batch;

  UPDATE public.jobs j
  SET status = public.derive_job_temporal_status(j.scheduled_date, j.start_time, j.user_id)
  WHERE j.status IN ('upcoming', 'today', 'missed');
  GET DIAGNOSTICS v_batch = ROW_COUNT;
  v_rows := v_rows + v_batch;

  RETURN v_rows;
END;
$$;

-- Recompute statuses for jobs that may have been misclassified under UTC date logic.
SELECT public.refresh_job_temporal_statuses();
