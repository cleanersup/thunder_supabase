-- Manual trigger: run send-job-reminders once (same as the daily cron)
-- Run on staging after setup:
--   docker exec -i supabase_db_euydrdzayvjahstvmwoj psql -U postgres -d postgres < scripts/staging-job-reminders-manual-test.sql
--
-- Then check edge logs:
--   docker logs supabase_edge_runtime_euydrdzayvjahstvmwoj --tail 100

\pset pager off

DO $$
DECLARE
  v_service_role_key text;
  v_request_id bigint;
BEGIN
  SELECT substring(command FROM 'Bearer ([^"]+)')
  INTO v_service_role_key
  FROM cron.job
  WHERE jobname = 'send-job-reminders-daily'
  LIMIT 1;

  IF v_service_role_key IS NULL THEN
    SELECT substring(command FROM 'Bearer ([^"]+)')
    INTO v_service_role_key
    FROM cron.job
    WHERE jobname = 'send-appointment-emails-daily'
    LIMIT 1;
  END IF;

  IF v_service_role_key IS NULL OR v_service_role_key = 'REPLACE_WITH_SERVICE_ROLE_KEY' THEN
    RAISE EXCEPTION 'No valid service role key found on cron jobs';
  END IF;

  SELECT net.http_post(
    url := 'http://kong:8000/functions/v1/send-job-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_service_role_key
    ),
    body := '{}'::jsonb
  )
  INTO v_request_id;

  RAISE NOTICE 'send-job-reminders invoked, pg_net request_id = %', v_request_id;
END $$;

-- pg_net response (may take a few seconds; re-run SELECT if status is null)
SELECT
  id,
  status_code,
  LEFT(content, 500) AS content_preview,
  created
FROM net._http_response
ORDER BY created DESC
LIMIT 5;
