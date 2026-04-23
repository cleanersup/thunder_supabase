-- ─────────────────────────────────────────────────────────────────────────────
-- Anti-fraud: payment_fraud_attempts table + stripe_session_id uniqueness guard
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Unique constraint on invoices.stripe_session_id
--    Prevents race conditions where two concurrent requests pass the app-level
--    guard and both try to save a session_id for the same invoice.
ALTER TABLE public.invoices
ADD CONSTRAINT invoices_stripe_session_id_unique UNIQUE (stripe_session_id);

-- 2. Fraud attempts log
--    Written by stripe-create-checkout (service role) whenever a payment
--    attempt is blocked before reaching Stripe.
--    Readable by the merchant who owns the targeted invoice.
CREATE TABLE public.payment_fraud_attempts (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id     UUID        REFERENCES public.invoices(id) ON DELETE SET NULL,
  merchant_user_id UUID,
  reason         TEXT        NOT NULL,   -- 'already_paid' | 'duplicate_session' | 'recaptcha_failed'
  ip_address     TEXT,
  user_agent     TEXT,
  metadata       JSONB       NOT NULL DEFAULT '{}'::jsonb,
  blocked_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_fraud_attempts_invoice_id       ON public.payment_fraud_attempts(invoice_id);
CREATE INDEX idx_fraud_attempts_merchant_user_id ON public.payment_fraud_attempts(merchant_user_id);
CREATE INDEX idx_fraud_attempts_blocked_at       ON public.payment_fraud_attempts(blocked_at DESC);
CREATE INDEX idx_fraud_attempts_reason           ON public.payment_fraud_attempts(reason);

-- RLS: merchants can read their own fraud attempts; only service role can insert
ALTER TABLE public.payment_fraud_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Merchants can view fraud attempts on their invoices"
ON public.payment_fraud_attempts
FOR SELECT
TO authenticated
USING (auth.uid() = merchant_user_id);

COMMENT ON TABLE  public.payment_fraud_attempts                  IS 'Log of blocked payment attempts — written by stripe-create-checkout edge function';
COMMENT ON COLUMN public.payment_fraud_attempts.reason           IS 'already_paid | duplicate_session | recaptcha_failed';
COMMENT ON COLUMN public.payment_fraud_attempts.ip_address       IS 'Client IP from x-forwarded-for or CF-Connecting-IP headers';
COMMENT ON COLUMN public.payment_fraud_attempts.metadata         IS 'Additional context: customer_email, amount_cents, invoice_number, etc.';
