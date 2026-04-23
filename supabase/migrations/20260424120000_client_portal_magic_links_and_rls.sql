-- Client portal: magic-link table, card snapshot columns on clients, contracts.accepted_at,
-- and RLS so authenticated portal users (JWT app_metadata) only see their own data.

-- ─── clients: Stripe / card display (read-only in portal; populated by admin / webhooks) ───
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS stripe_default_payment_method_id TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS card_brand TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS card_last4 TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS card_exp_month INTEGER DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS card_exp_year INTEGER DEFAULT NULL;

COMMENT ON COLUMN public.clients.stripe_customer_id IS 'Stripe Customer ID on the merchant Connect account';
COMMENT ON COLUMN public.clients.stripe_default_payment_method_id IS 'Default Stripe PaymentMethod id (pm_xxx)';
COMMENT ON COLUMN public.clients.card_brand IS 'Card brand snapshot for client portal display';
COMMENT ON COLUMN public.clients.card_last4 IS 'Last4 snapshot for client portal display';

-- ─── contracts: acceptance timestamp (client portal) ───
ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ DEFAULT NULL;

COMMENT ON COLUMN public.contracts.accepted_at IS 'When the client accepted the contract from the portal; NULL if not accepted.';

-- ─── client_magic_links (service role / Edge Functions only) ───
CREATE TABLE IF NOT EXISTS public.client_magic_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_email TEXT NOT NULL,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL CHECK (source IN ('invoice', 'contract', 'login')),
  redirect_to TEXT NOT NULL,
  expires_at TIMESTAMPTZ DEFAULT NULL,
  used_at TIMESTAMPTZ DEFAULT NULL,
  revoked_at TIMESTAMPTZ DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_magic_links_token_hash ON public.client_magic_links(token_hash);
CREATE INDEX IF NOT EXISTS idx_client_magic_links_email_owner ON public.client_magic_links(client_email, owner_id);

-- One non-finalized row per (email, owner); expiry enforced in application (partial index avoids now() in predicate)
DROP INDEX IF EXISTS idx_client_magic_links_active;
CREATE UNIQUE INDEX idx_client_magic_links_active
  ON public.client_magic_links (client_email, owner_id)
  WHERE used_at IS NULL AND revoked_at IS NULL;

ALTER TABLE public.client_magic_links ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.client_magic_links IS 'Hashed portal magic links; accessed only via service role Edge Functions.';

-- ─── RLS: portal clients use JWT app_metadata.active_owner_id / active_client_id (UUID text) ───

-- invoices
DROP POLICY IF EXISTS "Portal clients select own invoices" ON public.invoices;
CREATE POLICY "Portal clients select own invoices"
  ON public.invoices
  FOR SELECT
  TO authenticated
  USING (
    (auth.jwt()->'app_metadata'->>'active_owner_id') IS NOT NULL
    AND (auth.jwt()->'app_metadata'->>'active_client_id') IS NOT NULL
    AND status IS DISTINCT FROM 'Draft'
    AND user_id = ((auth.jwt()->'app_metadata'->>'active_owner_id')::uuid)
    AND lower(trim(email)) = lower(trim((
      SELECT c.email FROM public.clients c
      WHERE c.id = ((auth.jwt()->'app_metadata'->>'active_client_id')::uuid)
        AND c.user_id = ((auth.jwt()->'app_metadata'->>'active_owner_id')::uuid)
      LIMIT 1
    )))
  );

-- contracts
DROP POLICY IF EXISTS "Portal clients select own contracts" ON public.contracts;
CREATE POLICY "Portal clients select own contracts"
  ON public.contracts
  FOR SELECT
  TO authenticated
  USING (
    (auth.jwt()->'app_metadata'->>'active_owner_id') IS NOT NULL
    AND (auth.jwt()->'app_metadata'->>'active_client_id') IS NOT NULL
    AND user_id = ((auth.jwt()->'app_metadata'->>'active_owner_id')::uuid)
    AND status IS DISTINCT FROM 'Draft'
    AND (
      recipient_id = ((auth.jwt()->'app_metadata'->>'active_client_id')::uuid)
      OR (
        recipient_id IS NULL
        AND recipient_email IS NOT NULL
        AND lower(trim(recipient_email)) = lower(trim((
          SELECT c.email FROM public.clients c
          WHERE c.id = ((auth.jwt()->'app_metadata'->>'active_client_id')::uuid)
            AND c.user_id = ((auth.jwt()->'app_metadata'->>'active_owner_id')::uuid)
          LIMIT 1
        )))
      )
    )
  );

-- Portal may accept Sent/Pending contracts (same statuses as accept-contract Edge Function)
DROP POLICY IF EXISTS "Portal clients update own pending contracts" ON public.contracts;
CREATE POLICY "Portal clients update own pending contracts"
  ON public.contracts
  FOR UPDATE
  TO authenticated
  USING (
    (auth.jwt()->'app_metadata'->>'active_owner_id') IS NOT NULL
    AND (auth.jwt()->'app_metadata'->>'active_client_id') IS NOT NULL
    AND user_id = ((auth.jwt()->'app_metadata'->>'active_owner_id')::uuid)
    AND status IN ('Pending', 'Sent')
    AND (
      recipient_id = ((auth.jwt()->'app_metadata'->>'active_client_id')::uuid)
      OR (
        recipient_id IS NULL
        AND recipient_email IS NOT NULL
        AND lower(trim(recipient_email)) = lower(trim((
          SELECT c.email FROM public.clients c
          WHERE c.id = ((auth.jwt()->'app_metadata'->>'active_client_id')::uuid)
            AND c.user_id = ((auth.jwt()->'app_metadata'->>'active_owner_id')::uuid)
          LIMIT 1
        )))
      )
    )
  )
  WITH CHECK (
    user_id = ((auth.jwt()->'app_metadata'->>'active_owner_id')::uuid)
    AND status = 'Active'
    AND accepted_at IS NOT NULL
  );

-- clients: read own CRM row only (not merchant-owned auth.uid() match)
DROP POLICY IF EXISTS "Portal clients select own client row" ON public.clients;
CREATE POLICY "Portal clients select own client row"
  ON public.clients
  FOR SELECT
  TO authenticated
  USING (
    (auth.jwt()->'app_metadata'->>'active_owner_id') IS NOT NULL
    AND (auth.jwt()->'app_metadata'->>'active_client_id') IS NOT NULL
    AND id = ((auth.jwt()->'app_metadata'->>'active_client_id')::uuid)
    AND user_id = ((auth.jwt()->'app_metadata'->>'active_owner_id')::uuid)
  );

-- profiles: branding for active merchant only
DROP POLICY IF EXISTS "Portal clients select merchant profile for branding" ON public.profiles;
CREATE POLICY "Portal clients select merchant profile for branding"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    (auth.jwt()->'app_metadata'->>'active_owner_id') IS NOT NULL
    AND user_id = ((auth.jwt()->'app_metadata'->>'active_owner_id')::uuid)
  );
