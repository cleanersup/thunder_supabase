-- Client email open tracking (mark-viewed edge function), same idea as estimates.viewed_at
ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS viewed_at timestamp with time zone DEFAULT NULL;

COMMENT ON COLUMN public.contracts.viewed_at IS 'Set when client email is first opened (tracking pixel).';
