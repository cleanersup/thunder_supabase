-- Save as Draft / contract workflow (parity with thunder-web-version app behavior)
--
-- The app persists drafts with authenticated supabase.from('contracts').insert/update
-- and status = 'Draft'. New rows default to Draft via contracts.status DEFAULT.
-- RLS: existing policies (SELECT/INSERT/UPDATE/DELETE for auth.uid() = user_id) apply
-- to drafts the same as sent contracts; no separate draft policies or triggers.

COMMENT ON COLUMN public.contracts.status IS
  'Contract lifecycle: Draft (default, in-progress save from wizard), Sent (emailed), Pending (client opened email), Active (accepted), Expired.';

COMMENT ON TABLE public.contracts IS
  'Service agreements per user_id. Draft saves store full wizard payload (recipient_*, dates, sections jsonb, narrative fields, etc.) until send or completion.';
