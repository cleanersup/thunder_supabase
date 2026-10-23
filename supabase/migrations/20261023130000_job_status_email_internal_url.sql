-- Job status mail was posted to the public project URL with an empty bearer.
-- Inside Docker that call never reached the function, so a published job stayed
-- silent. Use the same internal Kong address as the employee notification.
-- confirmation_notified_at lets the app call and this trigger share one send.

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS confirmation_notified_at timestamptz;

COMMENT ON COLUMN public.jobs.confirmation_notified_at IS
  'Set when the job-confirmed email has been claimed, so publish does not send it twice.';

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
  v_client_channel text;
BEGIN
  SELECT j.client_notification_channel
  INTO v_client_channel
  FROM public.jobs j
  WHERE j.id = p_job_id;

  SELECT net.http_post(
    url := 'http://kong:8000/functions/v1/send-job-status-emails',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || coalesce(nullif(current_setting('app.settings.service_role_key', TRUE), ''), '')
    ),
    body := jsonb_build_object(
      'jobId', p_job_id::text,
      'previousStatus', p_previous_status,
      'newStatus', p_new_status,
      'operation', p_operation,
      'clientChannel', v_client_channel
    )
  ) INTO request_id;
END;
$$;

COMMENT ON FUNCTION public.dispatch_job_status_email (uuid, text, text, text) IS
  'Dispatches send-job-status-emails via internal Kong (http://kong:8000).';
