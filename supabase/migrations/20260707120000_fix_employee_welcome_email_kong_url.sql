-- Fix employee welcome-email trigger to use internal Kong URL (same pattern as SMS).
-- The previous version used app.settings / external Supabase Cloud URL, which fails
-- on self-hosted staging. SMS (send_employee_welcome_sms) already uses kong:8000.

DO $$
DECLARE
  sms_src text;
  auth_headers text := '{"Content-Type": "application/json", "Authorization": "Bearer REPLACE_WITH_SERVICE_ROLE_KEY"}';
  headers_match text;
BEGIN
  -- Reuse the same Authorization header already working in the SMS trigger.
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
    CREATE OR REPLACE FUNCTION public.send_employee_welcome_email ()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
    AS $body$
    DECLARE
      request_id bigint;
    BEGIN
      SELECT net.http_post(
        url := 'http://kong:8000/functions/v1/send-employee-welcome-email',
        headers := %L::jsonb,
        body := jsonb_build_object(
          'type', 'INSERT',
          'table', 'employees',
          'record', row_to_json(NEW),
          'schema', 'public'
        )
      ) INTO request_id;

      RETURN NEW;
    END;
    $body$;
  $fn$, auth_headers);
END;
$$;

COMMENT ON FUNCTION public.send_employee_welcome_email () IS
  'Dispatches send-employee-welcome-email on employee INSERT via internal Kong (http://kong:8000).';
