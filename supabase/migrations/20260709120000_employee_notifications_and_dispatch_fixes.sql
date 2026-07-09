-- Employee in-app notifications + fix job-employee dispatch URL for self-hosted staging.
--
-- 1. Add employee_id to notifications (employee-facing rows; owner rows keep employee_id NULL).
-- 2. Skip owner push trigger for employee-targeted notifications.
-- 3. Fix dispatch_job_employee_notification to use internal Kong URL (same as SMS triggers).

-- ── 1. employee_id on notifications ───────────────────────────────────────────
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS employee_id uuid REFERENCES public.employees (id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_notifications_employee_id
  ON public.notifications (employee_id, created_at DESC)
  WHERE employee_id IS NOT NULL;

COMMENT ON COLUMN public.notifications.employee_id IS
  'When set, this notification is for an employee (time-clock app). Owner rows keep employee_id NULL.';

-- ── 2. Owner push trigger: skip employee notifications ────────────────────────
CREATE OR REPLACE FUNCTION public.dispatch_notification_push ()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  request_id bigint;
  function_url text;
BEGIN
  -- Employee notifications are consumed in-app via edge functions; do not mirror to owner push.
  IF NEW.employee_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  function_url := coalesce(nullif(current_setting('app.settings.supabase_url', TRUE), ''), 'https://euydrdzayvjahstvmwoj.supabase.co')
    || '/functions/v1/notify-user-push';

  SELECT net.http_post(
    url := function_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || coalesce(nullif(current_setting('app.settings.service_role_key', TRUE), ''), '')
    ),
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
$$;

COMMENT ON FUNCTION public.dispatch_notification_push () IS
  'Mirrors owner in-app notifications to push via notify-user-push. Skips rows with employee_id set.';

-- ── 3. Fix job employee dispatch URL (self-hosted Kong) ───────────────────────
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
    CREATE OR REPLACE FUNCTION public.dispatch_job_employee_notification (
      p_job_id uuid,
      p_event_type text
    )
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
    AS $body$
    DECLARE
      request_id bigint;
    BEGIN
      SELECT net.http_post(
        url := 'http://kong:8000/functions/v1/notify-job-employees',
        headers := %L::jsonb,
        body := jsonb_build_object(
          'jobId', p_job_id::text,
          'eventType', p_event_type
        )
      ) INTO request_id;
    END;
    $body$;
  $fn$, auth_headers);
END;
$$;

COMMENT ON FUNCTION public.dispatch_job_employee_notification (uuid, text) IS
  'Dispatches notify-job-employees (push + SMS + email + in-app) via internal Kong (http://kong:8000).';
