-- Contract expiration automation: idempotent expiring notice + daily cron.
--
-- Dates: comparisons use calendar dates (contracts.end_date is date, no TZ).
-- Supabase DB session uses UTC for CURRENT_DATE; cron runs at 09:00 UTC.
-- "Within 30 days" = end_date is strictly after today and at most 30 days ahead.

ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS expiring_notice_sent_at timestamptz;

COMMENT ON COLUMN public.contracts.expiring_notice_sent_at IS
  'Set when the owner is notified that the contract is in the 30-day expiration window; prevents duplicate emails. Clear when renewing with a new end_date so a future window can notify again (app update).';

COMMENT ON COLUMN public.contracts.status IS
  'Contract lifecycle: Draft, Sent, Pending, Active, Expiring (≤30 days until end_date), Expired (end_date has passed).';

CREATE INDEX IF NOT EXISTS idx_contracts_expiration_job
  ON public.contracts (status, end_date)
  WHERE end_date IS NOT NULL AND (status = ANY (ARRAY['Active'::text, 'Expiring'::text]));

-- Daily batch (same slot as invoice / walkthrough reminders). Replace placeholder on deploy.
SELECT cron.schedule(
  'process-contract-expirations-daily',
  '5 9 * * *',
  $$
  SELECT
    net.http_post(
        url:='http://kong:8000/functions/v1/process-contract-expirations',
        headers:='{"Content-Type": "application/json", "Authorization": "Bearer REPLACE_WITH_SERVICE_ROLE_KEY"}'::jsonb,
        body:='{}'::jsonb
    ) AS request_id;
  $$
);
