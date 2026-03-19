-- Setup cron job to send appointment confirmation emails daily
-- This checks for appointments scheduled for today and sends confirmation emails
-- Emails are only sent once per appointment (tracked by email_sent field)

SELECT cron.schedule(
  'send-appointment-emails-daily',
  '0 8 * * *', -- Every day at 8:00 AM UTC (adjust timezone as needed)
  $$
  SELECT
    net.http_post(
        -- Use internal Kong URL for local Supabase on EC2
        url:='http://kong:8000/functions/v1/send-scheduled-appointment-emails',
        -- Headers with service role key for authentication
        headers:='{"Content-Type": "application/json", "Authorization": "Bearer REPLACE_WITH_SERVICE_ROLE_KEY"}'::jsonb,
        -- Empty body triggers batch mode (processes all appointments scheduled for today)
        body:='{}'::jsonb
    ) as request_id;
  $$
);
