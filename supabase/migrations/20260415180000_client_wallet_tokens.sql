-- Opaque tokens for public "client wallet" pages (view / add card via Stripe Setup Checkout).
-- Access only via service role in edge functions (RLS enabled, no policies for anon/authenticated).

CREATE TABLE IF NOT EXISTS public.client_wallet_tokens (
  token TEXT PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES public.clients (id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS client_wallet_tokens_client_id_idx
  ON public.client_wallet_tokens (client_id);

CREATE INDEX IF NOT EXISTS client_wallet_tokens_expires_at_idx
  ON public.client_wallet_tokens (expires_at);

ALTER TABLE public.client_wallet_tokens ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.client_wallet_tokens IS
  'Random URL tokens so clients can open /client/wallet/:token without login; issued by merchants via client-wallet-issue-token.';
