-- Owner push: fix Kong URL for dispatch_notification_push + lifecycle notification triggers.
--
-- Push delivery path: INSERT notifications → dispatch_notification_push → notify-user-push → FCM
-- Events covered:
--   estimate created (non-draft)
--   invoice created (non-draft)
--   job scheduled for today (status → today)
--   job started (status → ongoing, or employee clock-in on a job)
--   job completed / cancelled / missed (extended)
--   estimate accepted already handled by accept-estimate edge function

-- ── 1. dispatch_notification_push → internal Kong ───────────────────────────
DO $$
DECLARE
  sms_src text;
  auth_headers text := '{"Content-Type": "application/json", "Authorization": "Bearer REPLACE_WITH_SERVICE_ROLE_KEY"}';
  headers_match text;
BEGIN
  SELECT p.prosrc INTO sms_src
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public'
    AND p.proname = 'send_employee_welcome_sms'
    AND p.prokind = 'f';

  IF sms_src IS NOT NULL THEN
    headers_match := substring(sms_src from 'headers := ''(\{.*?\})''::jsonb');
    IF headers_match IS NOT NULL THEN
      auth_headers := headers_match;
    END IF;
  END IF;

  EXECUTE format($fn$
    CREATE OR REPLACE FUNCTION public.dispatch_notification_push ()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
    AS $body$
    DECLARE
      request_id bigint;
    BEGIN
      -- Employee notifications are consumed via edge functions; do not mirror to owner push.
      IF NEW.employee_id IS NOT NULL THEN
        RETURN NEW;
      END IF;

      SELECT net.http_post(
        url := 'http://kong:8000/functions/v1/notify-user-push',
        headers := %L::jsonb,
        body := jsonb_build_object(
          'userId', NEW.user_id::text,
          'title', NEW.title,
          'body', NEW.message,
          'data', jsonb_build_object(
            'notification_id', NEW.id::text,
            'type', coalesce(NEW.type, ''),
            'related_id', coalesce(NEW.related_id::text, ''),
            'related_type', coalesce(NEW.related_type, '')
          )
        )
      ) INTO request_id;

      RETURN NEW;
    END;
    $body$;
  $fn$, auth_headers);
END;
$$;

COMMENT ON FUNCTION public.dispatch_notification_push () IS
  'Mirrors owner in-app notifications to push via notify-user-push (internal Kong). Skips employee_id rows.';

-- ── 2. Job lifecycle → owner notification (extended) ──────────────────────────
CREATE OR REPLACE FUNCTION public.notify_owner_job_status ()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_label text;
  v_title text;
  v_msg   text;
  v_type  text;
BEGIN
  v_label := coalesce(NEW.job_number, 'A job');

  IF NEW.status = 'completed' THEN
    v_type := 'job_completed';
    v_title := 'Job completed';
    v_msg := v_label || coalesce(' for ' || NEW.client_name, '') || ' was marked completed.';
  ELSIF NEW.status = 'cancelled' THEN
    v_type := 'job_cancelled';
    v_title := 'Job cancelled';
    v_msg := v_label || coalesce(' for ' || NEW.client_name, '') || ' was cancelled.';
  ELSIF NEW.status = 'missed' THEN
    v_type := 'job_missed';
    v_title := 'Job missed';
    v_msg := v_label || coalesce(' for ' || NEW.client_name, '') || ' was not started and is now marked missed.';
  ELSIF NEW.status = 'ongoing' AND OLD.status IS DISTINCT FROM 'ongoing' THEN
    v_type := 'job_started';
    v_title := 'Job started';
    v_msg := v_label || coalesce(' for ' || NEW.client_name, '') || ' is now in progress.';
  ELSIF NEW.status = 'today' AND OLD.status IS DISTINCT FROM 'today' THEN
    v_type := 'schedule_day_started';
    v_title := 'Job scheduled for today';
    v_msg := v_label || coalesce(' for ' || NEW.client_name, '') || ' is scheduled for today.';
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications (user_id, type, title, message, related_id, related_type)
  VALUES (NEW.user_id, v_type, v_title, v_msg, NEW.id, 'job');

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.notify_owner_job_status () IS
  'Owner notification (→ push) on job today/ongoing/completed/cancelled/missed.';

DROP TRIGGER IF EXISTS on_job_status_notify_owner ON public.jobs;
CREATE TRIGGER on_job_status_notify_owner
  AFTER UPDATE OF status ON public.jobs
  FOR EACH ROW
  WHEN (
    OLD.status IS DISTINCT FROM NEW.status
    AND NEW.status IN ('today', 'ongoing', 'completed', 'cancelled', 'missed')
  )
  EXECUTE FUNCTION public.notify_owner_job_status ();

-- ── 3. Estimate created (non-draft) ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_owner_estimate_created ()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_number text;
  v_should_notify boolean := false;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_should_notify := coalesce(NEW.is_draft, false) = false;
  ELSIF TG_OP = 'UPDATE' THEN
    v_should_notify := coalesce(OLD.is_draft, false) = true
      AND coalesce(NEW.is_draft, false) = false;
  END IF;

  IF NOT v_should_notify THEN
    RETURN NEW;
  END IF;

  v_number := 'EST-' || upper(left(NEW.id::text, 6));

  INSERT INTO public.notifications (user_id, type, title, message, related_id, related_type)
  VALUES (
    NEW.user_id,
    'estimate_created',
    'New estimate created',
    'Estimate ' || v_number || ' for ' || coalesce(NEW.client_name, 'Client') ||
      ' ($' || trim(to_char(coalesce(NEW.total, 0), 'FM999999990.00')) || ')',
    NEW.id,
    'estimate'
  );

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.notify_owner_estimate_created () IS
  'Owner notification (→ push) when a non-draft estimate is created or published from draft.';

DROP TRIGGER IF EXISTS on_estimate_created_notify_owner ON public.estimates;
CREATE TRIGGER on_estimate_created_notify_owner
  AFTER INSERT OR UPDATE OF is_draft ON public.estimates
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_owner_estimate_created ();

-- ── 4. Invoice created (non-draft) ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_owner_invoice_created ()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'Draft' THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications (user_id, type, title, message, related_id, related_type)
  VALUES (
    NEW.user_id,
    'invoice_created',
    'New invoice created',
    'Invoice ' || coalesce(NEW.invoice_number, 'created') || ' for ' ||
      coalesce(NEW.client_name, 'Client') ||
      ' ($' || trim(to_char(coalesce(NEW.total, 0), 'FM999999990.00')) || ')',
    NEW.id,
    'invoice'
  );

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.notify_owner_invoice_created () IS
  'Owner notification (→ push) when a non-draft invoice is created.';

DROP TRIGGER IF EXISTS on_invoice_created_notify_owner ON public.invoices;
CREATE TRIGGER on_invoice_created_notify_owner
  AFTER INSERT ON public.invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_owner_invoice_created ();

-- ── 5. Employee clock-in on a job → owner notification ────────────────────────
CREATE OR REPLACE FUNCTION public.notify_owner_job_clock_in ()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job record;
  v_employee text;
  v_label text;
BEGIN
  IF NEW.job_id IS NULL OR NEW.clock_in_time IS NULL THEN
    RETURN NEW;
  END IF;

  -- Only fire on the first clock-in for this entry.
  IF TG_OP = 'UPDATE' AND OLD.clock_in_time IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT j.job_number, j.client_name, j.user_id
  INTO v_job
  FROM public.jobs j
  WHERE j.id = NEW.job_id;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  SELECT trim(coalesce(e.first_name, '') || ' ' || coalesce(e.last_name, ''))
  INTO v_employee
  FROM public.employees e
  WHERE e.id = NEW.employee_id;

  v_label := coalesce(v_job.job_number, 'A job');

  INSERT INTO public.notifications (user_id, type, title, message, related_id, related_type)
  VALUES (
    v_job.user_id,
    'job_started',
    'Job started',
    coalesce(nullif(trim(v_employee), ''), 'An employee') || ' clocked in on ' ||
      v_label || coalesce(' for ' || v_job.client_name, '') || '.',
    NEW.job_id,
    'job'
  );

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.notify_owner_job_clock_in () IS
  'Owner notification (→ push) when an employee clocks in on a job.';

DROP TRIGGER IF EXISTS on_time_entry_clock_in_notify_owner ON public.time_entries;
CREATE TRIGGER on_time_entry_clock_in_notify_owner
  AFTER INSERT OR UPDATE OF clock_in_time ON public.time_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_owner_job_clock_in ();
