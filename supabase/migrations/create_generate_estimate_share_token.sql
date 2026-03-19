-- Migration: create_generate_estimate_share_token.sql
-- This function generates a share token for an estimate.
-- It takes the estimate's UUID and returns a deterministic token string.
-- The token can be used in public URLs to access the estimate.

-- Drop existing function first to allow parameter name changes
DROP FUNCTION IF EXISTS public.generate_estimate_share_token(UUID);

create or replace function public.generate_estimate_share_token(estimate_id uuid)
returns text
language sql
security definer
as $$
  select encode(digest(estimate_id::text || now()::text, 'sha256'), 'hex');
$$;

-- Grant execute permission to authenticated role
grant execute on function public.generate_estimate_share_token(uuid) to authenticated;
