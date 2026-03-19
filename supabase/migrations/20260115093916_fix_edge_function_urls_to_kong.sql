-- Migration: Fix edge function URLs to use internal Kong instead of Supabase Cloud
-- Issue: Triggers and cron jobs were pointing to https://euydrdzayvjahstvmwoj.supabase.co
--        instead of internal Kong URL (http://kong:8000)
-- Solution: Update all pg_net HTTP calls to use internal Kong URL with correct service_role_key

-- ============================================================================
-- 1. Fix send_employee_welcome_sms() trigger function
-- ============================================================================
CREATE OR REPLACE FUNCTION public.send_employee_welcome_sms()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  request_id bigint;
BEGIN
  -- Make an async HTTP POST request to the edge function using internal Kong URL
  SELECT net.http_post(
    url := 'http://kong:8000/functions/v1/send-employee-sms',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer REPLACE_WITH_SERVICE_ROLE_KEY"}'::jsonb,
    body := jsonb_build_object(
      'type', 'INSERT',
      'table', 'employees',
      'record', row_to_json(NEW),
      'schema', 'public'
    )
  ) INTO request_id;

  RETURN NEW;
END;
$$;

-- ============================================================================
-- 2. Fix send-walkthrough-reminders cron job
-- ============================================================================
-- First, remove the old cron job
SELECT cron.unschedule('send-walkthrough-reminders-hourly');

-- Create the updated cron job with internal Kong URL
SELECT cron.schedule(
  'send-walkthrough-reminders-hourly',
  '*/5 * * * *', -- Every 5 minutes
  $$
  SELECT
    net.http_post(
        url:='http://kong:8000/functions/v1/send-walkthrough-reminders',
        headers:='{"Content-Type": "application/json", "Authorization": "Bearer REPLACE_WITH_SERVICE_ROLE_KEY"}'::jsonb,
        body:='{}'::jsonb
    ) as request_id;
  $$
);

-- ============================================================================
-- Comments
-- ============================================================================
COMMENT ON FUNCTION public.send_employee_welcome_sms() IS
'Trigger function that sends welcome SMS to new employees via edge function.
Uses internal Kong URL (http://kong:8000) for AWS/self-hosted Supabase setup.';
