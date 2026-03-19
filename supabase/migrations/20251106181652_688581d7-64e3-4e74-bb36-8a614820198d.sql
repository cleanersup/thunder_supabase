-- Setup cron job to send walkthrough reminders every 5 minutes
-- This checks for walkthroughs happening in approximately 1 hour

SELECT cron.schedule(
  'send-walkthrough-reminders-hourly',
  '*/5 * * * *', -- Every 5 minutes
  $$
  SELECT
    net.http_post(
        url:='https://euydrdzayvjahstvmwoj.supabase.co/functions/v1/send-walkthrough-reminders',
        headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV1eWRyZHpheXZqYWhzdHZtd29qIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjEwNzkwMjgsImV4cCI6MjA3NjY1NTAyOH0.U3sJPWgXqNtfibqiVMXsI0Om5AYrEvuUgQ3deb3Tz44"}'::jsonb,
        body:='{}'::jsonb
    ) as request_id;
  $$
);