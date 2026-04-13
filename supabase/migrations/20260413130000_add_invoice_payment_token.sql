-- ─────────────────────────────────────────────────────────────────────────────
-- Invoice payment_token — opaque public URL token (mirrors estimates pattern)
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Add column
ALTER TABLE public.invoices
ADD COLUMN IF NOT EXISTS payment_token TEXT UNIQUE;

CREATE INDEX IF NOT EXISTS idx_invoices_payment_token
ON public.invoices(payment_token);

-- 2. Auto-generate trigger (same logic as auto_generate_estimate_share_token)
CREATE OR REPLACE FUNCTION public.auto_generate_invoice_payment_token()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  new_token TEXT;
  token_exists BOOLEAN;
BEGIN
  IF NEW.payment_token IS NULL OR NEW.payment_token = '' THEN
    LOOP
      new_token := encode(extensions.gen_random_bytes(16), 'base64');
      new_token := replace(replace(replace(new_token, '/', '_'), '+', '-'), '=', '');
      SELECT EXISTS(SELECT 1 FROM invoices WHERE payment_token = new_token) INTO token_exists;
      EXIT WHEN NOT token_exists;
    END LOOP;
    NEW.payment_token := new_token;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_auto_generate_invoice_payment_token ON invoices;

CREATE TRIGGER trigger_auto_generate_invoice_payment_token
  BEFORE INSERT OR UPDATE ON invoices
  FOR EACH ROW
  EXECUTE FUNCTION auto_generate_invoice_payment_token();

-- 3. Backfill existing invoices
UPDATE public.invoices
SET payment_token = encode(extensions.gen_random_bytes(16), 'base64')
WHERE payment_token IS NULL;

-- Sanitize backfilled tokens (remove URL-unsafe chars)
UPDATE public.invoices
SET payment_token = replace(replace(replace(payment_token, '/', '_'), '+', '-'), '=', '')
WHERE payment_token LIKE '%/%' OR payment_token LIKE '%+%' OR payment_token LIKE '%=%';

-- 4. RLS — anyone can read an invoice by its payment_token (public payment page)
--    Existing SELECT policy covers authenticated users; this covers anon.
CREATE POLICY "Public read invoice by payment_token"
ON public.invoices
FOR SELECT
TO anon
USING (payment_token IS NOT NULL);

COMMENT ON COLUMN public.invoices.payment_token IS
'Opaque URL-safe token used in public payment links (/invoice/payment/:token). Replaces raw UUID in URLs to prevent enumeration attacks.';
