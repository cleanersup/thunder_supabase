-- Job reminders: table + cron on self-hosted staging (staging.thunderpro.co)
-- Run from repo root on the server:
--   docker exec -i supabase_db_euydrdzayvjahstvmwoj psql -U postgres -d postgres < scripts/staging-job-reminders-setup.sql
--
-- Before running: deploy the edge function and restart edge runtime:
--   scp -r supabase/functions/send-job-reminders staging.thunderpro.co:/home/admin/thunder_supabase/supabase/functions/
--   (ensure config.toml includes [functions.send-job-reminders] verify_jwt = false)
--   docker restart supabase_edge_runtime_euydrdzayvjahstvmwoj

\pset pager off

-- ---------------------------------------------------------------------------
-- 1) Tracking table (dedupe 24h + day-of reminders)
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 2) Optional client notification channel on jobs (status emails)
-- ---------------------------------------------------------------------------
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS client_notification_channel text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'jobs_client_notification_channel_check'
  ) THEN
    ALTER TABLE public.jobs
      ADD CONSTRAINT jobs_client_notification_channel_check
      CHECK (
        client_notification_channel IS NULL
        OR client_notification_channel IN ('email', 'sms', 'both')
      );
  END IF;
END $$;

COMMENT ON COLUMN public.jobs.client_notification_channel IS
  'How to notify the client on status change: email (default), sms, or both.';

-- ---------------------------------------------------------------------------
-- 3) dispatch_job_status_email — pass clientChannel from job row
-- ---------------------------------------------------------------------------
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
  v_service_role_key text;
BEGIN
  SELECT j.client_notification_channel
  INTO v_client_channel
  FROM public.jobs j
  WHERE j.id = p_job_id;

  SELECT substring(command FROM 'Bearer ([^"]+)')
  INTO v_service_role_key
  FROM cron.job
  WHERE jobname = 'send-appointment-emails-daily'
  LIMIT 1;

  function_url := coalesce(
    nullif(current_setting('app.settings.supabase_url', TRUE), ''),
    'https://euydrdzayvjahstvmwoj.supabase.co'
  ) || '/functions/v1/send-job-status-emails';

  SELECT
    net.http_post(
      url := function_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || coalesce(
          nullif(current_setting('app.settings.service_role_key', TRUE), ''),
          v_service_role_key,
          ''
        )
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

-- ---------------------------------------------------------------------------
-- 4) Cron: daily 9:00 UTC — copies Bearer token from working appointment cron
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_service_role_key text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not installed — skipping send-job-reminders-daily schedule';
    RETURN;
  END IF;

  SELECT substring(command FROM 'Bearer ([^"]+)')
  INTO v_service_role_key
  FROM cron.job
  WHERE jobname = 'send-appointment-emails-daily'
  LIMIT 1;

  IF v_service_role_key IS NULL OR v_service_role_key = 'REPLACE_WITH_SERVICE_ROLE_KEY' THEN
    RAISE EXCEPTION
      'Could not read service role key from cron job send-appointment-emails-daily. '
      'Fix that cron first, or set v_service_role_key manually in this script.';
  END IF;

  BEGIN
    PERFORM cron.unschedule('send-job-reminders-daily');
  EXCEPTION
    WHEN others THEN
      NULL;
  END;

  PERFORM cron.schedule(
    'send-job-reminders-daily',
    '0 9 * * *',
    format(
      $cron$
      SELECT
        net.http_post(
          url := 'http://kong:8000/functions/v1/send-job-reminders',
          headers := '{"Content-Type": "application/json", "Authorization": "Bearer %s"}'::jsonb,
          body := '{}'::jsonb
        ) AS request_id;
      $cron$,
      v_service_role_key
    )
  );

  RAISE NOTICE 'Scheduled send-job-reminders-daily with key from send-appointment-emails-daily';
END $$;

-- ---------------------------------------------------------------------------
-- 5) Verify
-- ---------------------------------------------------------------------------
SELECT
  jobname,
  schedule,
  active,
  CASE
    WHEN command LIKE '%REPLACE_WITH_SERVICE_ROLE_KEY%' THEN 'NEEDS KEY FIX'
    WHEN command LIKE '%Bearer sb_%' OR command LIKE '%Bearer eyJ%' THEN 'key present'
    ELSE 'check command'
  END AS auth_status
FROM cron.job
WHERE jobname IN ('send-job-reminders-daily', 'send-appointment-emails-daily')
ORDER BY jobname;

SELECT EXISTS (
  SELECT 1
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name = 'job_notifications_sent'
) AS job_notifications_sent_exists;

-- Jobs eligible for reminders (preview — uses UTC dates like the edge function)
SELECT
  id,
  job_number,
  status,
  scheduled_date,
  client_email,
  client_name
FROM public.jobs
WHERE client_email IS NOT NULL
  AND btrim(client_email) <> ''
  AND status IN ('upcoming', 'today')
  AND scheduled_date IN (
    (CURRENT_DATE AT TIME ZONE 'UTC')::date,
    ((CURRENT_DATE AT TIME ZONE 'UTC') + interval '1 day')::date
  )
ORDER BY scheduled_date, start_time
LIMIT 20;
