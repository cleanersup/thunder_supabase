-- Push notifications for clock-in/clock-out and scheduling route appointments.
--
-- 1. time_entries: replace notify_owner_job_clock_in with a broader
--    notify_owner_clock_event that also covers clock-in without a job
--    (generic time clock) and clock-out (previously not notified at all).
-- 2. route_appointments: notify owner on create and on reschedule/status
--    change (previously had zero notification triggers).

-- ── 1. Clock-in / clock-out ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_owner_clock_event ()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_employee text;
  v_job record;
  v_label text;
BEGIN
  SELECT trim(coalesce(e.first_name, '') || ' ' || coalesce(e.last_name, ''))
  INTO v_employee
  FROM public.employees e
  WHERE e.id = NEW.employee_id;

  -- Clock-in (only the first time it's set).
  IF NEW.clock_in_time IS NOT NULL
     AND (TG_OP = 'INSERT' OR OLD.clock_in_time IS NULL) THEN
    IF NEW.job_id IS NOT NULL THEN
      SELECT j.job_number, j.client_name INTO v_job
      FROM public.jobs j
      WHERE j.id = NEW.job_id;

      v_label := coalesce(v_job.job_number, 'a job');

      INSERT INTO public.notifications (user_id, type, title, message, related_id, related_type)
      VALUES (
        NEW.user_id,
        'job_started',
        'Job started',
        coalesce(nullif(trim(v_employee), ''), 'An employee') || ' clocked in on ' ||
          v_label || coalesce(' for ' || v_job.client_name, '') || '.',
        NEW.job_id,
        'job'
      );
    ELSE
      INSERT INTO public.notifications (user_id, type, title, message, related_id, related_type)
      VALUES (
        NEW.user_id,
        'employee_clocked_in',
        'Employee clocked in',
        coalesce(nullif(trim(v_employee), ''), 'An employee') || ' clocked in.',
        NEW.employee_id,
        'employee'
      );
    END IF;
  END IF;

  -- Clock-out (only the first time it's set).
  IF NEW.clock_out_time IS NOT NULL
     AND (TG_OP = 'INSERT' OR OLD.clock_out_time IS NULL) THEN
    INSERT INTO public.notifications (user_id, type, title, message, related_id, related_type)
    VALUES (
      NEW.user_id,
      'employee_clocked_out',
      'Employee clocked out',
      coalesce(nullif(trim(v_employee), ''), 'An employee') || ' clocked out.',
      NEW.employee_id,
      'employee'
    );
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.notify_owner_clock_event () IS
  'Owner notification (-> push) on clock-in (job or generic) and clock-out.';

DROP TRIGGER IF EXISTS on_time_entry_clock_in_notify_owner ON public.time_entries;
DROP TRIGGER IF EXISTS on_time_entry_clock_event_notify_owner ON public.time_entries;
CREATE TRIGGER on_time_entry_clock_event_notify_owner
  AFTER INSERT OR UPDATE OF clock_in_time, clock_out_time ON public.time_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_owner_clock_event ();

-- ── 2. Scheduling: route appointments ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_owner_route_appointment_change ()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client text;
BEGIN
  SELECT c.full_name INTO v_client
  FROM public.clients c
  WHERE c.id = NEW.client_id;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.notifications (user_id, type, title, message, related_id, related_type)
    VALUES (
      NEW.user_id,
      'appointment_scheduled',
      'Appointment scheduled',
      'Appointment scheduled for ' || coalesce(v_client, 'a client') ||
        ' on ' || to_char(NEW.scheduled_date, 'FMMonth FMDD, YYYY') || '.',
      NEW.id,
      'route_appointment'
    );
    RETURN NEW;
  END IF;

  -- UPDATE: reschedule (date/time changed) takes priority over a plain status change.
  IF NEW.scheduled_date IS DISTINCT FROM OLD.scheduled_date
     OR NEW.scheduled_time IS DISTINCT FROM OLD.scheduled_time THEN
    INSERT INTO public.notifications (user_id, type, title, message, related_id, related_type)
    VALUES (
      NEW.user_id,
      'appointment_rescheduled',
      'Appointment rescheduled',
      'Appointment for ' || coalesce(v_client, 'a client') ||
        ' was rescheduled to ' || to_char(NEW.scheduled_date, 'FMMonth FMDD, YYYY') || '.',
      NEW.id,
      'route_appointment'
    );
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.notifications (user_id, type, title, message, related_id, related_type)
    VALUES (
      NEW.user_id,
      'appointment_status_changed',
      'Appointment updated',
      'Appointment for ' || coalesce(v_client, 'a client') || ' is now ' || NEW.status || '.',
      NEW.id,
      'route_appointment'
    );
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.notify_owner_route_appointment_change () IS
  'Owner notification (-> push) on route appointment creation, reschedule, or status change.';

DROP TRIGGER IF EXISTS on_route_appointment_notify_owner ON public.route_appointments;
CREATE TRIGGER on_route_appointment_notify_owner
  AFTER INSERT OR UPDATE ON public.route_appointments
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_owner_route_appointment_change ();
