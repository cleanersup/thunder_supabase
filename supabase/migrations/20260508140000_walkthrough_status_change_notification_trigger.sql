-- After walkthrough status changes, notify via Edge Function (same pattern as bookings + pg_net).

CREATE OR REPLACE FUNCTION public.notify_walkthrough_status_change_send_email ()
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
    || '/functions/v1/send-walkthrough-status-emails';
  SELECT
    net.http_post (url := function_url, headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || coalesce(nullif(current_setting('app.settings.service_role_key', TRUE), ''), '')), body := jsonb_build_object('walkthroughId', NEW.id::text, 'previousStatus', OLD.status, 'newStatus', NEW.status))
  INTO
    request_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_walkthrough_status_change_send_email ON public.walkthroughs;

CREATE TRIGGER on_walkthrough_status_change_send_email
  AFTER UPDATE OF status ON public.walkthroughs
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.notify_walkthrough_status_change_send_email ();

COMMENT ON FUNCTION public.notify_walkthrough_status_change_send_email () IS 'pg_net → send-walkthrough-status-emails after walkthrough status updates (Scheduled, Completed, Converted, Cancelled, etc.).';
