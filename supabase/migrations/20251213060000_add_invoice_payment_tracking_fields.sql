-- Add payment tracking fields to invoices table
-- These fields store Stripe payment information when an invoice is paid

ALTER TABLE public.invoices
ADD COLUMN IF NOT EXISTS paid_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS stripe_payment_intent_id TEXT,
ADD COLUMN IF NOT EXISTS stripe_session_id TEXT;

-- Add indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_invoices_stripe_payment_intent_id
ON public.invoices(stripe_payment_intent_id);

CREATE INDEX IF NOT EXISTS idx_invoices_stripe_session_id
ON public.invoices(stripe_session_id);

-- Add comment for documentation
COMMENT ON COLUMN public.invoices.paid_at IS 'Timestamp when the invoice was paid via Stripe';
COMMENT ON COLUMN public.invoices.stripe_payment_intent_id IS 'Stripe Payment Intent ID associated with this invoice payment';
COMMENT ON COLUMN public.invoices.stripe_session_id IS 'Stripe Checkout Session ID used for payment';
