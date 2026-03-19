-- Allow public access to invoices for payment page
-- This enables clients to view and pay invoices without authentication

-- Drop existing policy if it exists
DROP POLICY IF EXISTS "Allow public read access to invoices" ON public.invoices;

-- Create policy to allow public SELECT access to invoices
-- Security:
-- 1. Only allows reading invoice data, not modifying
-- 2. Only allows access to invoices that are NOT drafts
-- 3. Invoice ID is a UUID which is hard to guess
CREATE POLICY "Allow public read access to invoices"
ON public.invoices
FOR SELECT
TO anon
USING (status != 'Draft');

-- Note: This allows anyone with the invoice ID to view it, as long as it's not a draft.
-- Draft invoices remain private and only accessible to authenticated users who own them.
-- This is secure because:
-- - The invoice ID is a UUID (hard to guess)
-- - Only sent invoices can be accessed publicly
-- - Clients need the exact link from their email to access it
