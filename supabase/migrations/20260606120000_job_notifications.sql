-- Job notification tracking + client channel preference + reminder cron

-- 1) Tracking table for automated reminder deduplication
CREATE TABLE IF NOT EXISTS public.job_notifications_sent (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('reminder_24h', 'reminder_day_of')),
  sent_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(job_id, type)
);

COMMENT ON TABLE public.job_notifications_sent IS
  'Tracks automated job reminder emails (24h before and day-of) to prevent duplicates.';

CREATE INDEX IF NOT EXISTS idx_job_notifications_sent_job_id
  ON public.job_notifications_sent(job_id);

ALTER TABLE public.job_notifications_sent ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view reminders for their jobs" ON public.job_notifications_sent;
CREATE POLICY "Users can view reminders for their jobs"
ON public.job_notifications_sent
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.jobs j
    WHERE j.id = job_notifications_sent.job_id
      AND j.user_id = auth.uid()
  )
);

-- 2) Optional client notification channel (set by frontend before status change)
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS client_notification_channel text
  CHECK (
    client_notification_channel IS NULL
    OR client_notification_channel IN ('email', 'sms', 'both')
  );

COMMENT ON COLUMN public.jobs.client_notification_channel IS
  'How to notify the client on status change: email (default), sms, or both. SMS is sent by send-job-status-sms from the frontend.';

-- 3) Pass clientChannel from job row into status email dispatch
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
  v_client_channel text;
BEGIN
  SELECT j.client_notification_channel
  INTO v_client_channel
  FROM public.jobs j
  WHERE j.id = p_job_id;

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
        'operation', p_operation,
        'clientChannel', v_client_channel
      )
    )
  INTO request_id;
END;
$$;

COMMENT ON FUNCTION public.dispatch_job_status_email (uuid, text, text, text) IS
'Dispatches send-job-status-emails with optional clientChannel from jobs.client_notification_channel.';

-- 4) Daily cron at 9:00 AM UTC for job reminders
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule('send-job-reminders-daily');
    EXCEPTION
      WHEN others THEN
        NULL;
    END;

    PERFORM cron.schedule(
      'send-job-reminders-daily',
      '0 9 * * *',
      $cron$
      SELECT
        net.http_post(
          url := 'http://kong:8000/functions/v1/send-job-reminders',
          headers := '{"Content-Type": "application/json", "Authorization": "Bearer REPLACE_WITH_SERVICE_ROLE_KEY"}'::jsonb,
          body := '{}'::jsonb
        ) AS request_id;
      $cron$
    );
  END IF;
END;
$$;
