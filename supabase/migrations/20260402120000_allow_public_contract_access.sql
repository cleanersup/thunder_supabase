-- Public contract page + SMS/email links (parity with invoices: allow anon SELECT when not Draft).

DROP POLICY IF EXISTS "Allow public read access to contracts" ON public.contracts;

CREATE POLICY "Allow public read access to contracts"
ON public.contracts
FOR SELECT
TO anon
USING (status != 'Draft');

-- Drafts stay owner-only via existing authenticated policies. Shared links rely on public_share_token UUID.
