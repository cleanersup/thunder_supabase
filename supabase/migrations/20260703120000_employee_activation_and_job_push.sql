-- ─────────────────────────────────────────────────────────────────────────────
-- Employee activation state + welcome email trigger + job→employee push dispatch.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Employee activation timestamp ──────────────────────────────────────────
-- Set by the system (verify-employee-otp) the first time an employee logs in.
-- This is SEPARATE from employees.status (active/suspended), which the owner
-- manages manually. activated_at is never set by hand.
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS activated_at timestamptz;

COMMENT ON COLUMN public.employees.activated_at IS
  'When the employee first installed the app and completed OTP login. System-set only, once. '
  'Distinct from employees.status (employment state managed by the owner).';

-- ── 2. Welcome email on employee INSERT ──────────────────────────────────────
-- Mirrors the existing send-employee-sms trigger but dispatches the welcome email.
CREATE OR REPLACE FUNCTION public.send_employee_welcome_email ()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  request_id bigint;
  function_url text;
BEGIN
  function_url := coalesce(nullif(current_setting('app.settings.supabase_url', TRUE), ''), 'https://euydrdzayvjahstvmwoj.supabase.co')
    || '/functions/v1/send-employee-welcome-email';

  SELECT net.http_post(
    url := function_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || coalesce(nullif(current_setting('app.settings.service_role_key', TRUE), ''), '')
    ),
    body := jsonb_build_object(
      'type', 'INSERT',
      'table', 'employees',
      'record', row_to_json(NEW),
      'schema', 'public'
    )
  ) INTO request_id;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.send_employee_welcome_email () IS
  'Dispatches send-employee-welcome-email when a new employee is inserted (skips if no email).';

DROP TRIGGER IF EXISTS on_employee_created_send_email ON public.employees;
CREATE TRIGGER on_employee_created_send_email
  AFTER INSERT ON public.employees
  FOR EACH ROW
  EXECUTE FUNCTION public.send_employee_welcome_email ();

-- ── 3. Job → employee push dispatch ──────────────────────────────────────────
-- Notifies assigned employees when a job is assigned / rescheduled / cancelled.
-- The edge function decides push vs SMS-fallback per employee.
CREATE OR REPLACE FUNCTION public.dispatch_job_employee_notification (
  p_job_id uuid,
  p_event_type text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  request_id bigint;
  function_url text;
BEGIN
  function_url := coalesce(nullif(current_setting('app.settings.supabase_url', TRUE), ''), 'https://euydrdzayvjahstvmwoj.supabase.co')
    || '/functions/v1/notify-job-employees';

  SELECT net.http_post(
    url := function_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || coalesce(nullif(current_setting('app.settings.service_role_key', TRUE), ''), '')
    ),
    body := jsonb_build_object(
      'jobId', p_job_id::text,
      'eventType', p_event_type
    )
  ) INTO request_id;
END;
$$;

COMMENT ON FUNCTION public.dispatch_job_employee_notification (uuid, text) IS
  'Dispatches notify-job-employees (push + SMS fallback) for assigned/rescheduled/cancelled jobs.';

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
  'Fires employee push/SMS notifications on job assignment, reschedule, or cancellation.';

DROP TRIGGER IF EXISTS on_job_insert_notify_employees ON public.jobs;
CREATE TRIGGER on_job_insert_notify_employees
  AFTER INSERT ON public.jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_job_employees_change ();

DROP TRIGGER IF EXISTS on_job_update_notify_employees ON public.jobs;
CREATE TRIGGER on_job_update_notify_employees
  AFTER UPDATE ON public.jobs
  FOR EACH ROW
  WHEN (
    OLD.status IS DISTINCT FROM NEW.status
    OR OLD.scheduled_date IS DISTINCT FROM NEW.scheduled_date
    OR OLD.start_time IS DISTINCT FROM NEW.start_time
    OR OLD.assigned_employees::text IS DISTINCT FROM NEW.assigned_employees::text
  )
  EXECUTE FUNCTION public.notify_job_employees_change ();
