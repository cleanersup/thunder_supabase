-- Public token for contract PDF download links (same pattern as estimates)

ALTER TABLE public.contracts ADD COLUMN IF NOT EXISTS public_share_token uuid;

UPDATE public.contracts SET public_share_token = gen_random_uuid() WHERE public_share_token IS NULL;

ALTER TABLE public.contracts ALTER COLUMN public_share_token SET DEFAULT gen_random_uuid();
ALTER TABLE public.contracts ALTER COLUMN public_share_token SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_contracts_public_share_token ON public.contracts(public_share_token);
