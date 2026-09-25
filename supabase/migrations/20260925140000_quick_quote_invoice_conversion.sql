-- Quick quote → invoice, same shape as quote → job:
-- invoices.quick_quote_id <-> quick_quotes.invoice_id, owner guards, prefill RPC,
-- atomic finalize. A quote can still become a job as well; the two links are
-- independent. Re-converting the same quote to a second invoice is rejected.

ALTER TABLE public.quick_quotes
  ADD COLUMN IF NOT EXISTS invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.quick_quotes.invoice_id IS
  'Invoice created/linked from this quick quote conversion.';

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS quick_quote_id uuid REFERENCES public.quick_quotes(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.invoices.quick_quote_id IS
  'Source quick quote when this invoice was converted from a quick quote.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_quick_quote_id
  ON public.invoices(quick_quote_id)
  WHERE quick_quote_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_quick_quotes_invoice_id
  ON public.quick_quotes(invoice_id)
  WHERE invoice_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.enforce_quick_quote_invoice_same_owner ()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.invoice_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.invoices i
      WHERE i.id = NEW.invoice_id
        AND i.user_id = NEW.user_id
    ) THEN
      RAISE EXCEPTION 'quick_quotes.invoice_id must reference an invoice owned by the same user';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_enforce_quick_quote_invoice_owner ON public.quick_quotes;
CREATE TRIGGER tr_enforce_quick_quote_invoice_owner
  BEFORE INSERT OR UPDATE OF invoice_id, user_id ON public.quick_quotes
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_quick_quote_invoice_same_owner ();

CREATE OR REPLACE FUNCTION public.enforce_invoice_quick_quote_same_owner ()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.quick_quote_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.quick_quotes q
      WHERE q.id = NEW.quick_quote_id
        AND q.user_id = NEW.user_id
    ) THEN
      RAISE EXCEPTION 'invoices.quick_quote_id must reference a quick quote owned by the same user';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_enforce_invoice_quick_quote_owner ON public.invoices;
CREATE TRIGGER tr_enforce_invoice_quick_quote_owner
  BEFORE INSERT OR UPDATE OF quick_quote_id, user_id ON public.invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_invoice_quick_quote_same_owner ();

CREATE OR REPLACE FUNCTION public.get_quick_quote_invoice_prefill (p_quick_quote_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_quote public.quick_quotes;
  v_subtotal numeric;
  v_discount_value numeric;
  v_discount_type text;
  v_total numeric;
  v_service text;
BEGIN
  SELECT * INTO v_quote
  FROM public.quick_quotes
  WHERE id = p_quick_quote_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quick quote not found';
  END IF;

  v_subtotal := ROUND(COALESCE(v_quote.subtotal, 0), 2);
  v_discount_value := COALESCE(v_quote.discount_value, 0);
  v_discount_type := CASE
    WHEN lower(COALESCE(v_quote.discount_type, '')) IN ('percent', 'percentage') THEN 'percentage'
    ELSE 'fixed'
  END;
  v_total := public.quick_quote_display_total(v_quote);
  v_service := COALESCE(
    NULLIF(btrim(v_quote.service_sub_type), ''),
    NULLIF(btrim(v_quote.service_type), ''),
    'Residential'
  );

  RETURN jsonb_build_object(
    'quick_quote_id', v_quote.id,
    'client_name', COALESCE(v_quote.recipient_name, ''),
    'email', COALESCE(v_quote.recipient_email, ''),
    'phone', COALESCE(v_quote.recipient_phone, ''),
    'service_type', 'Single Payment',
    'invoice_name', v_service,
    'invoice_date', COALESCE(v_quote.quote_date, CURRENT_DATE),
    'due_date', COALESCE(v_quote.quote_date, CURRENT_DATE),
    'line_items', jsonb_build_array(
      jsonb_build_object(
        'description', COALESCE(NULLIF(btrim(v_quote.service_scope), ''), v_service),
        'price', v_subtotal,
        'qty', 1,
        'total', v_subtotal
      )
    ),
    'discount_type', CASE WHEN v_discount_value > 0 THEN v_discount_type ELSE NULL END,
    'discount_value', CASE WHEN v_discount_value > 0 THEN v_discount_value ELSE NULL END,
    'tax_rate', NULL,
    'total', v_total,
    'notes', v_quote.service_scope,
    'status', 'Draft'
  );
END;
$$;

COMMENT ON FUNCTION public.get_quick_quote_invoice_prefill (uuid) IS
  'Returns invoice-shaped fields from a quick quote. Address/client are left to the user — a quote has neither.';

GRANT EXECUTE ON FUNCTION public.get_quick_quote_invoice_prefill (uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.finalize_quick_quote_to_invoice_conversion (
  p_quick_quote_id uuid,
  p_invoice_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_quote record;
  v_inv record;
  v_rows int;
  v_status text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_quote
  FROM public.quick_quotes
  WHERE id = p_quick_quote_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quick quote not found';
  END IF;
  IF v_quote.user_id <> v_uid THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  IF v_quote.invoice_id IS NOT NULL AND v_quote.invoice_id IS DISTINCT FROM p_invoice_id THEN
    RAISE EXCEPTION 'Quick quote is already linked to another invoice';
  END IF;

  SELECT * INTO v_inv
  FROM public.invoices
  WHERE id = p_invoice_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found';
  END IF;
  IF v_inv.user_id <> v_uid THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  IF v_inv.quick_quote_id IS NOT NULL AND v_inv.quick_quote_id IS DISTINCT FROM p_quick_quote_id THEN
    RAISE EXCEPTION 'Invoice is already linked to another quick quote';
  END IF;

  UPDATE public.invoices
  SET quick_quote_id = p_quick_quote_id
  WHERE id = p_invoice_id
    AND user_id = v_uid;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'Failed to link invoice to quick quote';
  END IF;

  -- Job conversion already writes Converted; do not overwrite that.
  v_status := CASE
    WHEN v_quote.status = 'Converted' THEN 'Converted'
    ELSE 'Invoiced'
  END;

  UPDATE public.quick_quotes
  SET
    invoice_id = p_invoice_id,
    status = v_status,
    is_draft = false
  WHERE id = p_quick_quote_id
    AND user_id = v_uid;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'Failed to mark quick quote as invoiced';
  END IF;

  RETURN jsonb_build_object(
    'invoice_id', p_invoice_id,
    'quick_quote_id', p_quick_quote_id,
    'invoice', (SELECT to_jsonb(i.*) FROM public.invoices i WHERE i.id = p_invoice_id),
    'quick_quote', (SELECT to_jsonb(q.*) FROM public.quick_quotes q WHERE q.id = p_quick_quote_id)
  );
END;
$$;

COMMENT ON FUNCTION public.finalize_quick_quote_to_invoice_conversion (uuid, uuid) IS
  'Atomic conversion: links quick quote to invoice both ways. Status becomes Invoiced unless it was already Converted to a job.';

GRANT EXECUTE ON FUNCTION public.finalize_quick_quote_to_invoice_conversion (uuid, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
