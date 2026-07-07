-- Fix employee notifications when a draft job is published with employees already assigned.
-- Previously notify_job_employees_change only fired on assignment list changes, not on
-- draft -> upcoming (publish). Also skip recurring child instance INSERTs to avoid spam.

CREATE OR REPLACE FUNCTION public.notify_job_employees_change ()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_has_employees boolean;
BEGIN
  v_has_employees := jsonb_array_length(coalesce(NEW.assigned_employees, '[]'::jsonb)) > 0;

  IF TG_OP = 'INSERT' THEN
    -- Recurring child instances are generated in bulk on parent publish; the parent
    -- publish notification already covers the assignment.
    IF NEW.parent_job_id IS NOT NULL THEN
      RETURN NEW;
    END IF;

    -- Newly created job that already has employees and is not a draft.
    IF v_has_employees AND NEW.status NOT IN ('draft', 'cancelled') THEN
      PERFORM public.dispatch_job_employee_notification(NEW.id, 'assigned');
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  -- Cancellation takes priority.
  IF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
    IF v_has_employees THEN
      PERFORM public.dispatch_job_employee_notification(NEW.id, 'cancelled');
    END IF;
    RETURN NEW;
  END IF;

  -- Publish: draft -> active lifecycle (employees may have been assigned while still draft).
  IF OLD.status = 'draft' AND NEW.status NOT IN ('draft', 'cancelled') THEN
    IF v_has_employees THEN
      PERFORM public.dispatch_job_employee_notification(NEW.id, 'assigned');
    END IF;
    RETURN NEW;
  END IF;

  -- Only notify for active (non-draft, non-cancelled) jobs beyond this point.
  IF NEW.status IN ('draft', 'cancelled') THEN
    RETURN NEW;
  END IF;

  -- Reschedule: date or start time changed.
  IF NEW.scheduled_date IS DISTINCT FROM OLD.scheduled_date
     OR NEW.start_time IS DISTINCT FROM OLD.start_time THEN
    IF v_has_employees THEN
      PERFORM public.dispatch_job_employee_notification(NEW.id, 'rescheduled');
    END IF;
    RETURN NEW;
  END IF;

  -- New assignment: the employee list changed.
  IF NEW.assigned_employees::text IS DISTINCT FROM OLD.assigned_employees::text THEN
    IF v_has_employees THEN
      PERFORM public.dispatch_job_employee_notification(NEW.id, 'assigned');
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.notify_job_employees_change () IS
  'Fires employee push+SMS on job publish (draft->active), assignment, reschedule, or cancellation.';

COMMENT ON FUNCTION public.dispatch_job_employee_notification (uuid, text) IS
  'Dispatches notify-job-employees (push + SMS to all employees with phone) for assigned/rescheduled/cancelled jobs.';
