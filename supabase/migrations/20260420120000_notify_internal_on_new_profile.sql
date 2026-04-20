-- Notify info@thunderpro.co when a new user profile is created (dashboard + mobile signup).
-- Uses pg_net + notify-internal-registration edge function (same pattern as send_employee_welcome_sms).

CREATE OR REPLACE FUNCTION public.notify_internal_on_profile_created()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  request_id bigint;
  function_url text;
BEGIN
  function_url := current_setting('app.settings.supabase_url', true) ||
    '/functions/v1/notify-internal-registration';

  IF function_url IS NULL OR function_url = '' THEN
    function_url := 'https://euydrdzayvjahstvmwoj.supabase.co/functions/v1/notify-internal-registration';
  END IF;

  SELECT net.http_post(
    url := function_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body := jsonb_build_object(
      'type', 'INSERT',
      'table', 'profiles',
      'record', row_to_json(NEW),
      'schema', 'public'
    )
  ) INTO request_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_profile_created_notify_internal ON public.profiles;

CREATE TRIGGER on_profile_created_notify_internal
  AFTER INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_internal_on_profile_created();

COMMENT ON FUNCTION public.notify_internal_on_profile_created() IS
  'POSTs new profile row to notify-internal-registration edge function for internal email alert.';
