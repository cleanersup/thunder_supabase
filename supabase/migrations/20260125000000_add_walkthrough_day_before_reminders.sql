-- Migration: Add 1-day-before walkthrough reminders
-- This adds support for sending reminders 1 day before walkthroughs are scheduled

-- ============================================================================
-- 1. Update walkthrough_reminders_sent table to allow '1d' reminder type
-- ============================================================================
ALTER TABLE public.walkthrough_reminders_sent
DROP CONSTRAINT IF EXISTS walkthrough_reminders_sent_reminder_type_check;

ALTER TABLE public.walkthrough_reminders_sent
ADD CONSTRAINT walkthrough_reminders_sent_reminder_type_check 
CHECK (reminder_type IN ('confirmation', '1h', '1d'));

-- ============================================================================
-- 2. Setup cron job to send 1-day-before walkthrough reminders daily
-- ============================================================================
-- This cron job runs every day at 9:00 AM UTC to check for walkthroughs scheduled for tomorrow
-- and sends reminders to both the client and the owner

SELECT cron.schedule(
  'send-walkthrough-day-before-reminders-daily',
  '0 9 * * *', -- Every day at 9:00 AM UTC
  $$
  SELECT
    net.http_post(
        -- Use internal Kong URL for local Supabase on EC2
        url:='http://kong:8000/functions/v1/send-walkthrough-day-before-reminders',
        -- Headers with service role key for authentication
        headers:='{"Content-Type": "application/json", "Authorization": "Bearer REPLACE_WITH_SERVICE_ROLE_KEY"}'::jsonb,
        -- Empty body triggers batch mode (processes all walkthroughs scheduled for tomorrow)
        body:='{}'::jsonb
    ) as request_id;
  $$
);
