-- Check every 5 minutes for jobs that start in about one hour.
-- The daily 9:00 UTC cron still sends the tomorrow reminder.
-- This schedule only posts scope=starting_soon.

DO $$
DECLARE
  v_service_role_key text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not installed — skipping send-job-reminders-starting-soon';
    RETURN;
  END IF;

  SELECT substring(command FROM 'Bearer ([^"]+)')
  INTO v_service_role_key
  FROM cron.job
  WHERE jobname IN (
    'send-job-reminders-daily',
    'send-walkthrough-reminders-hourly',
    'send-appointment-emails-daily'
  )
    AND command LIKE '%Bearer %'
    AND command NOT LIKE '%REPLACE_WITH_SERVICE_ROLE_KEY%'
  ORDER BY CASE jobname
    WHEN 'send-job-reminders-daily' THEN 0
    WHEN 'send-walkthrough-reminders-hourly' THEN 1
    ELSE 2
  END
  LIMIT 1;

  IF v_service_role_key IS NULL OR v_service_role_key = '' THEN
    RAISE EXCEPTION
      'Could not read a service role key from an existing reminder cron. Schedule send-job-reminders-starting-soon after that cron has a real Bearer token.';
  END IF;

  BEGIN
    PERFORM cron.unschedule('send-job-reminders-starting-soon');
  EXCEPTION
    WHEN others THEN
      NULL;
  END;

  PERFORM cron.schedule(
    'send-job-reminders-starting-soon',
    '*/5 * * * *',
    format(
      $cron$
      SELECT
        net.http_post(
          url := 'http://kong:8000/functions/v1/send-job-reminders',
          headers := '{"Content-Type": "application/json", "Authorization": "Bearer %s"}'::jsonb,
          body := '{"scope":"starting_soon"}'::jsonb
        ) AS request_id;
      $cron$,
      v_service_role_key
    )
  );
END $$;
