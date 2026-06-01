-- Unify job status email dispatch with a request-style dispatcher
-- and add notifications when estimate/walkthrough are converted to jobs.

CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.dispatch_job_status_email (
  p_job_id uuid,
  p_previous_status text,
  p_new_status text,
  p_operation text DEFAULT 'UPDATE'
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
    || '/functions/v1/send-job-status-emails';

  SELECT
    net.http_post(
      url := function_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || coalesce(nullif(current_setting('app.settings.service_role_key', TRUE), ''), '')
      ),
      body := jsonb_build_object(
        'jobId', p_job_id::text,
        'previousStatus', p_previous_status,
        'newStatus', p_new_status,
        'operation', p_operation
      )
    )
  INTO request_id;
END;
$$;

COMMENT ON FUNCTION public.dispatch_job_status_email (uuid, text, text, text) IS
'Explicit helper to dispatch job status emails via send-job-status-emails.';

CREATE OR REPLACE FUNCTION public.notify_job_status_change_send_email ()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.dispatch_job_status_email(NEW.id, OLD.status, NEW.status, 'UPDATE');
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.notify_job_status_change_send_email () IS
'Queues send-job-status-emails after successful job status updates.';

DROP TRIGGER IF EXISTS on_job_status_change_send_email ON public.jobs;
CREATE TRIGGER on_job_status_change_send_email
  AFTER UPDATE OF status ON public.jobs
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.notify_job_status_change_send_email ();

CREATE OR REPLACE FUNCTION public.dispatch_job_conversion_email (
  p_job_id uuid,
  p_source_type text,
  p_source_id uuid,
  p_operation text DEFAULT 'CONVERT'
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
    || '/functions/v1/send-job-conversion-emails';

  SELECT
    net.http_post(
      url := function_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || coalesce(nullif(current_setting('app.settings.service_role_key', TRUE), ''), '')
      ),
      body := jsonb_build_object(
        'jobId', p_job_id::text,
        'sourceType', p_source_type,
        'sourceId', p_source_id::text,
        'operation', p_operation
      )
    )
  INTO request_id;
END;
$$;

COMMENT ON FUNCTION public.dispatch_job_conversion_email (uuid, text, uuid, text) IS
'Dispatches conversion notification when an estimate/walkthrough links to a job.';

CREATE OR REPLACE FUNCTION public.notify_estimate_to_job_conversion_send_email ()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.dispatch_job_conversion_email(NEW.job_id, 'estimate', NEW.id, 'UPDATE');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_estimate_to_job_conversion_send_email ON public.estimates;
CREATE TRIGGER on_estimate_to_job_conversion_send_email
  AFTER UPDATE OF job_id ON public.estimates
  FOR EACH ROW
  WHEN (NEW.job_id IS NOT NULL AND OLD.job_id IS DISTINCT FROM NEW.job_id)
  EXECUTE FUNCTION public.notify_estimate_to_job_conversion_send_email ();

CREATE OR REPLACE FUNCTION public.notify_walkthrough_to_job_conversion_send_email ()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.dispatch_job_conversion_email(NEW.job_id, 'walkthrough', NEW.id, 'UPDATE');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_walkthrough_to_job_conversion_send_email ON public.walkthroughs;
CREATE TRIGGER on_walkthrough_to_job_conversion_send_email
  AFTER UPDATE OF job_id ON public.walkthroughs
  FOR EACH ROW
  WHEN (NEW.job_id IS NOT NULL AND OLD.job_id IS DISTINCT FROM NEW.job_id)
  EXECUTE FUNCTION public.notify_walkthrough_to_job_conversion_send_email ();
