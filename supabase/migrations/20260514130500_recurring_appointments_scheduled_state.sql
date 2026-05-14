-- Keep `scheduled` as an active status for recurring route_appointments.
-- Applies to recurring appointments created directly and from recurring jobs.

-- 1) Preserve scheduled for recurring appointments in normalization trigger.
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

  -- For recurring appointments, keep `scheduled` as a stable state.
  IF NEW.status = 'scheduled'
     AND NULLIF(trim(COALESCE(NEW.recurring_frequency, '')), '') IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Keep legacy status usable while gradually migrating clients.
  IF NEW.status = 'scheduled' THEN
    NEW.status := public.derive_route_appointment_temporal_status(NEW.scheduled_date);
  END IF;

  -- Temporal states are driven by date.
  IF NEW.status IN ('upcoming', 'today', 'missed') THEN
    NEW.status := public.derive_route_appointment_temporal_status(NEW.scheduled_date);
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.normalize_route_appointment_status () IS
  'Normalizes route_appointments status. Preserves scheduled for recurring appointments; non-recurring scheduled is derived by date.';

-- 2) Do not convert recurring scheduled rows during batch refresh.
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
  WHERE ra.status IN ('upcoming', 'today', 'missed')
     OR (
       ra.status = 'scheduled'
       AND NULLIF(trim(COALESCE(ra.recurring_frequency, '')), '') IS NULL
     );

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$;

COMMENT ON FUNCTION public.refresh_route_appointment_temporal_statuses () IS
  'Recomputes temporal states from scheduled_date; keeps recurring scheduled appointments unchanged.';

-- 3) Ensure recurring jobs synced to route_appointments get `scheduled` status.
CREATE OR REPLACE FUNCTION public.sync_job_to_route_appointment ()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_route_id uuid;
  v_appointment_status text;
BEGIN
  -- No client = no schedule row
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

COMMENT ON FUNCTION public.sync_job_to_route_appointment () IS
  'Keeps route_appointments in sync with jobs. Recurring jobs map to scheduled status.';
