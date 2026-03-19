-- Setup cron job to send invoice reminders daily
-- This checks for invoices due today and sends payment reminders to clients

SELECT cron.schedule(
  'send-invoice-reminders-daily',
  '0 9 * * *', -- Every day at 9:00 AM UTC (adjust timezone as needed)
  $$
  SELECT
    net.http_post(
        -- Use internal Kong URL for local Supabase on EC2
        url:='http://kong:8000/functions/v1/send-invoice-reminders',
        -- Headers with service role key for authentication
        headers:='{"Content-Type": "application/json", "Authorization": "Bearer REPLACE_WITH_SERVICE_ROLE_KEY"}'::jsonb,
        -- Empty body triggers batch mode (processes all invoices due today)
        body:='{}'::jsonb
    ) as request_id;
  $$
);
