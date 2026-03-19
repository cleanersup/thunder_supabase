-- Add refunded_at column to invoices table
-- This column stores the timestamp when an invoice was refunded via Stripe

ALTER TABLE invoices
ADD COLUMN IF NOT EXISTS refunded_at timestamptz;

-- Add comment for documentation
COMMENT ON COLUMN invoices.refunded_at IS 'Timestamp when the invoice was refunded via Stripe webhook';
