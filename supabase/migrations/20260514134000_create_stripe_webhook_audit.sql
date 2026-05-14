-- Persistent audit trail for Stripe webhook processing.
-- Helps debug mismatches between Stripe success and invoice state updates.

CREATE TABLE IF NOT EXISTS public.stripe_webhook_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id text NOT NULL UNIQUE,
  event_type text NOT NULL,
  livemode boolean NOT NULL DEFAULT false,
  stripe_account_id text,
  merchant_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  stripe_payment_intent_id text,
  stripe_session_id text,
  final_action text NOT NULL DEFAULT 'received',
  ok boolean NOT NULL DEFAULT false,
  error_message text,
  payload_excerpt jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stripe_webhook_audit_event_type
ON public.stripe_webhook_audit(event_type);

CREATE INDEX IF NOT EXISTS idx_stripe_webhook_audit_invoice
ON public.stripe_webhook_audit(resolved_invoice_id)
WHERE resolved_invoice_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_stripe_webhook_audit_session
ON public.stripe_webhook_audit(stripe_session_id)
WHERE stripe_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_stripe_webhook_audit_pi
ON public.stripe_webhook_audit(stripe_payment_intent_id)
WHERE stripe_payment_intent_id IS NOT NULL;

ALTER TABLE public.stripe_webhook_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own stripe webhook audit rows" ON public.stripe_webhook_audit;
CREATE POLICY "Users can view their own stripe webhook audit rows"
ON public.stripe_webhook_audit
FOR SELECT
USING (auth.uid() = merchant_user_id);

DROP POLICY IF EXISTS "Service role can manage stripe webhook audit rows" ON public.stripe_webhook_audit;
CREATE POLICY "Service role can manage stripe webhook audit rows"
ON public.stripe_webhook_audit
FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

DROP TRIGGER IF EXISTS update_stripe_webhook_audit_updated_at ON public.stripe_webhook_audit;
CREATE TRIGGER update_stripe_webhook_audit_updated_at
  BEFORE UPDATE ON public.stripe_webhook_audit
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.stripe_webhook_audit IS
  'Stripe webhook processing audit log with final action and errors for each Stripe event.';

COMMENT ON COLUMN public.stripe_webhook_audit.final_action IS
  'Last processing outcome for event_id (e.g., received, invoice_marked_paid, skip_no_invoice, update_failed).';
