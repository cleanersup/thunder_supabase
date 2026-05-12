-- Jobs lifecycle for route_appointments (diagram-aligned)
-- Canonical states:
-- draft -> upcoming -> today -> ongoing -> completed
--                      \-> missed
-- cancel from active states -> cancelled
-- Legacy "scheduled" is accepted and normalized by date.

-- 1) Normalize existing data first
UPDATE public.route_appointments
SET status = lower(trim(status))
WHERE status IS NOT NULL
  AND status <> lower(trim(status));

UPDATE public.route_appointments
SET status = 'cancelled'
WHERE status IN ('canceled');

UPDATE public.route_appointments
SET status = CASE
  WHEN scheduled_date > CURRENT_DATE THEN 'upcoming'
  WHEN scheduled_date = CURRENT_DATE THEN 'today'
  ELSE 'missed'
END
WHERE status = 'scheduled';

-- 2) Constrain allowed statuses
ALTER TABLE public.route_appointments
  DROP CONSTRAINT IF EXISTS route_appointments_status_check;

ALTER TABLE public.route_appointments
  ALTER COLUMN status SET DEFAULT 'draft';

ALTER TABLE public.route_appointments
  ADD CONSTRAINT route_appointments_status_check CHECK (status IN (
    'draft',
    'scheduled', -- legacy compatibility
    'upcoming',
    'today',
    'ongoing',
    'missed',
    'completed',
    'cancelled'
  ));

COMMENT ON CONSTRAINT route_appointments_status_check ON public.route_appointments IS
  'Jobs lifecycle: draft -> upcoming -> today -> ongoing -> completed; upcoming/today can become missed; cancel from active states to cancelled. Legacy scheduled is accepted and normalized by trigger.';

-- 3) Shared helper: derive temporal status from scheduled_date
CREATE OR REPLACE FUNCTION public.derive_route_appointment_temporal_status (p_scheduled_date date)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
BEGIN
  IF p_scheduled_date > CURRENT_DATE THEN
    RETURN 'upcoming';
  ELSIF p_scheduled_date = CURRENT_DATE THEN
    RETURN 'today';
  END IF;
  RETURN 'missed';
END;
$$;

COMMENT ON FUNCTION public.derive_route_appointment_temporal_status (date) IS
  'Returns upcoming/today/missed from a scheduled_date relative to CURRENT_DATE.';

-- 4) BEFORE trigger: normalize aliases/casing and keep temporal states coherent
CREATE OR REPLACE FUNCTION public.normalize_route_appointment_status ()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.status := COALESCE(NULLIF(trim(NEW.status), ''), 'draft');
  NEW.status := lower(NEW.status);

  IF NEW.status = 'canceled' THEN
    NEW.status := 'cancelled';
  END IF;

  -- Keep legacy status usable while gradually migrating clients.
  IF NEW.status = 'scheduled' THEN
    NEW.status := public.derive_route_appointment_temporal_status(NEW.scheduled_date);
  END IF;

  -- Temporal states are driven by date.
  IF NEW.status IN ('upcoming', 'today', 'missed') THEN
    NEW.status := public.derive_route_appointment_temporal_status(NEW.scheduled_date);
  END IF;

  -- If user moves date while job is still in draft, keep draft.
  -- Transition out of draft happens when frontend sends upcoming/today or via explicit status update.
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_normalize_route_appointment_status ON public.route_appointments;

CREATE TRIGGER tr_normalize_route_appointment_status
  BEFORE INSERT OR UPDATE OF status, scheduled_date ON public.route_appointments
  FOR EACH ROW
  EXECUTE FUNCTION public.normalize_route_appointment_status ();

-- 5) Sync ongoing/completed from clock-in/out time entries
CREATE OR REPLACE FUNCTION public.sync_route_appointment_status_from_time_entries ()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_route_appointment_id uuid := COALESCE(NEW.route_appointment_id, OLD.route_appointment_id);
  v_has_active boolean := false;
  v_has_completed boolean := false;
  v_current_status text;
BEGIN
  IF v_route_appointment_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT
    EXISTS (
      SELECT 1
      FROM public.time_entries te
      WHERE te.route_appointment_id = v_route_appointment_id
        AND te.clock_in_time IS NOT NULL
        AND te.clock_out_time IS NULL
    ),
    EXISTS (
      SELECT 1
      FROM public.time_entries te
      WHERE te.route_appointment_id = v_route_appointment_id
        AND te.clock_out_time IS NOT NULL
    )
  INTO v_has_active, v_has_completed;

  SELECT status
  INTO v_current_status
  FROM public.route_appointments
  WHERE id = v_route_appointment_id
  FOR UPDATE;

  IF NOT FOUND OR v_current_status IN ('cancelled', 'draft') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF v_has_active THEN
    UPDATE public.route_appointments
    SET status = 'ongoing'
    WHERE id = v_route_appointment_id
      AND status IS DISTINCT FROM 'ongoing';
  ELSIF v_has_completed THEN
    UPDATE public.route_appointments
    SET status = 'completed'
    WHERE id = v_route_appointment_id
      AND status IS DISTINCT FROM 'completed';
  ELSIF v_current_status IN ('ongoing', 'today', 'upcoming', 'missed', 'scheduled') THEN
    UPDATE public.route_appointments
    SET status = public.derive_route_appointment_temporal_status(scheduled_date)
    WHERE id = v_route_appointment_id;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS tr_sync_route_appointment_status_from_time_entries ON public.time_entries;

CREATE TRIGGER tr_sync_route_appointment_status_from_time_entries
  AFTER INSERT OR UPDATE OR DELETE ON public.time_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_route_appointment_status_from_time_entries ();

-- 6) Batch refresh helper for cron/manual execution
CREATE OR REPLACE FUNCTION public.refresh_route_appointment_temporal_statuses ()
RETURNS integer
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_rows integer;
BEGIN
  UPDATE public.route_appointments ra
  SET status = public.derive_route_appointment_temporal_status(ra.scheduled_date)
  WHERE ra.status IN ('scheduled', 'upcoming', 'today', 'missed');

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$;

COMMENT ON FUNCTION public.refresh_route_appointment_temporal_statuses () IS
  'Recomputes temporal job states (scheduled/upcoming/today/missed) from scheduled_date.';

-- 7) Keep reminder index useful with new states
DROP INDEX IF EXISTS idx_route_appointments_email_sent_date;

CREATE INDEX IF NOT EXISTS idx_route_appointments_email_sent_date
ON public.route_appointments(scheduled_date, email_sent, status)
WHERE email_sent = false
  AND status IN ('scheduled', 'upcoming', 'today');

-- 8) Optional cron (if pg_cron exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule('refresh-route-appointments-status');
    EXCEPTION
      WHEN others THEN
        NULL;
    END;

    PERFORM cron.schedule(
      'refresh-route-appointments-status',
      '*/30 * * * *',
      'SELECT public.refresh_route_appointment_temporal_statuses();'
    );
  END IF;
END;
$$;
