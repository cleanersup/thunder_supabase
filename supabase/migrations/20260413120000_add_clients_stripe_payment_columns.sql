-- Stripe Customer + saved card (on merchant Connect account) for CRM clients
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT,
  ADD COLUMN IF NOT EXISTS stripe_default_payment_method_id TEXT,
  ADD COLUMN IF NOT EXISTS card_brand TEXT,
  ADD COLUMN IF NOT EXISTS card_last4 TEXT,
  ADD COLUMN IF NOT EXISTS card_exp_month SMALLINT,
  ADD COLUMN IF NOT EXISTS card_exp_year SMALLINT;

COMMENT ON COLUMN public.clients.stripe_customer_id IS 'Stripe Customer id on the merchant connected account';
COMMENT ON COLUMN public.clients.stripe_default_payment_method_id IS 'Default PaymentMethod id for off-session charges';
COMMENT ON COLUMN public.clients.card_brand IS 'Card brand from last saved payment method (display)';
COMMENT ON COLUMN public.clients.card_last4 IS 'Last 4 digits from last saved payment method (display)';
