-- Quick Quotes
-- A residential estimate without a client and without a service address: the owner
-- prices a job on the spot and types the recipient email/phone only when sending.
--
-- Mirrors public.estimates (residential fields, pricing, cost breakdown, draft
-- support, share token, viewed_at) minus every client/address column, and adds the
-- same estimate -> job conversion plumbing (quick_quotes.job_id <-> jobs.quick_quote_id).
--
-- Everything except id/user_id/timestamps is nullable: a quote can be saved empty.

-- ─── 1) Table ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.quick_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),

  -- Recipient typed by the owner at send time (there is no client record).
  recipient_name text,
  recipient_email text,
  recipient_phone text,

  -- Service definition (same shape the residential estimate wizard produces).
  service_type text DEFAULT 'residential',
  service_sub_type text,
  service_scope text,
  main_data jsonb DEFAULT '{}'::jsonb,
  additional_data jsonb DEFAULT '{}'::jsonb,
  additional_items jsonb DEFAULT '[]'::jsonb,
  extra_services jsonb DEFAULT '{}'::jsonb,
  pets text,
  laundry text,

  -- Pricing shown to the recipient.
  discount_type text,
  discount_value numeric,
  subtotal numeric DEFAULT 0,
  total numeric DEFAULT 0,

  -- Internal cost breakdown (owner copy only, never shown to the recipient).
  labor_cost numeric,
  supplies_cost numeric,
  overhead_cost numeric,
  total_operation_cost numeric,

  -- Lifecycle. Conventional values: Draft, Pending, Sent, Accepted, Declined,
  -- Converted, Canceled. Left unconstrained, exactly like public.estimates.status.
  status text DEFAULT 'Pending',
  quote_date date DEFAULT CURRENT_DATE,

  -- Draft/wizard support (same contract as estimates).
  is_draft boolean DEFAULT false,
  current_step integer DEFAULT 0,
  draft_data jsonb,

  -- Public sharing + delivery tracking.
  public_share_token text UNIQUE,
  viewed_at timestamptz,
  sent_at timestamptz,
  last_sent_channel text,

  -- Conversion link.
  job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.quick_quotes IS
  'Client-less residential quote. Same fields as a residential estimate minus client and address; recipient email/phone are captured when sending.';
COMMENT ON COLUMN public.quick_quotes.recipient_email IS
  'Email typed by the owner when sending. Not a client record.';
COMMENT ON COLUMN public.quick_quotes.recipient_phone IS
  'Phone typed by the owner when sending. Not a client record.';
COMMENT ON COLUMN public.quick_quotes.last_sent_channel IS
  'email | sms — last delivery channel used, written by the send edge functions.';
COMMENT ON COLUMN public.quick_quotes.job_id IS
  'Job created/linked from this quick quote conversion.';

CREATE INDEX IF NOT EXISTS idx_quick_quotes_user_created
  ON public.quick_quotes(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_quick_quotes_user_status
  ON public.quick_quotes(user_id, status);

CREATE INDEX IF NOT EXISTS idx_quick_quotes_user_draft
  ON public.quick_quotes(user_id, is_draft)
  WHERE is_draft = true;

CREATE INDEX IF NOT EXISTS idx_quick_quotes_public_share_token
  ON public.quick_quotes(public_share_token);

-- ─── 2) RLS: owner-only, no anon SELECT (public reads go through the RPC) ─────

ALTER TABLE public.quick_quotes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own quick quotes" ON public.quick_quotes;
CREATE POLICY "Users can view their own quick quotes"
  ON public.quick_quotes
  FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can create their own quick quotes" ON public.quick_quotes;
CREATE POLICY "Users can create their own quick quotes"
  ON public.quick_quotes
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own quick quotes" ON public.quick_quotes;
CREATE POLICY "Users can update their own quick quotes"
  ON public.quick_quotes
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own quick quotes" ON public.quick_quotes;
CREATE POLICY "Users can delete their own quick quotes"
  ON public.quick_quotes
  FOR DELETE
  USING (auth.uid() = user_id);

-- ─── 3) updated_at ────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS update_quick_quotes_updated_at ON public.quick_quotes;
CREATE TRIGGER update_quick_quotes_updated_at
  BEFORE UPDATE ON public.quick_quotes
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- ─── 4) Share token ───────────────────────────────────────────────────────────
-- Generated on insert so a quote is always sendable without an extra round trip.

CREATE OR REPLACE FUNCTION public.assign_quick_quote_share_token ()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
BEGIN
  IF NEW.public_share_token IS NULL OR btrim(NEW.public_share_token) = '' THEN
    NEW.public_share_token := encode(extensions.gen_random_bytes(24), 'hex');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_assign_quick_quote_share_token ON public.quick_quotes;
CREATE TRIGGER tr_assign_quick_quote_share_token
  BEFORE INSERT ON public.quick_quotes
  FOR EACH ROW
  EXECUTE FUNCTION public.assign_quick_quote_share_token ();

-- Rotate/force a token for an existing quote (owner only).
CREATE OR REPLACE FUNCTION public.generate_quick_quote_share_token (p_quick_quote_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, extensions
AS $$
DECLARE
  v_token text;
BEGIN
  LOOP
    v_token := encode(extensions.gen_random_bytes(24), 'hex');
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.quick_quotes WHERE public_share_token = v_token
    );
  END LOOP;

  UPDATE public.quick_quotes
  SET public_share_token = v_token
  WHERE id = p_quick_quote_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quick quote not found';
  END IF;

  RETURN v_token;
END;
$$;

COMMENT ON FUNCTION public.generate_quick_quote_share_token (uuid) IS
  'Rotates the public share token of a quick quote. RLS applies: owner only.';

GRANT EXECUTE ON FUNCTION public.generate_quick_quote_share_token (uuid) TO authenticated;

-- ─── 5) Public read by share token (mirrors get_public_estimate) ──────────────

CREATE OR REPLACE FUNCTION public.get_public_quick_quote (p_token text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_id uuid;
  v_row jsonb;
BEGIN
  IF p_token IS NULL OR btrim(p_token) = '' THEN
    RETURN NULL;
  END IF;

  SELECT q.id
  INTO v_id
  FROM public.quick_quotes q
  WHERE q.public_share_token = p_token
     OR (
       public._is_uuid(p_token)
       AND q.id = p_token::uuid
       AND q.public_share_token IS NOT NULL
     )
  LIMIT 1;

  IF v_id IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE public.quick_quotes
  SET viewed_at = COALESCE(viewed_at, now())
  WHERE id = v_id
    AND viewed_at IS NULL;

  -- Internal cost columns never leave the owner's side.
  SELECT to_jsonb(q) - 'labor_cost' - 'supplies_cost' - 'overhead_cost' - 'total_operation_cost' - 'draft_data'
  INTO v_row
  FROM public.quick_quotes q
  WHERE q.id = v_id;

  RETURN v_row;
END;
$$;

COMMENT ON FUNCTION public.get_public_quick_quote (text) IS
  'Public quick quote by share token (or by id when shared). Marks viewed_at and strips internal cost columns.';

GRANT EXECUTE ON FUNCTION public.get_public_quick_quote (text) TO anon, authenticated;

-- ─── 6) Pricing helpers (shared by the prefill RPC) ───────────────────────────

CREATE OR REPLACE FUNCTION public.quick_quote_discount_amount (
  p_subtotal numeric,
  p_discount_type text,
  p_discount_value numeric
)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN COALESCE(p_discount_value, 0) <= 0 THEN 0
    WHEN lower(COALESCE(p_discount_type, '')) IN ('percent', 'percentage')
      THEN ROUND(COALESCE(p_subtotal, 0) * p_discount_value / 100.0, 2)
    ELSE ROUND(p_discount_value, 2)
  END;
$$;

CREATE OR REPLACE FUNCTION public.quick_quote_display_total (p_quote public.quick_quotes)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT GREATEST(
    ROUND(
      COALESCE(p_quote.subtotal, 0)
      - public.quick_quote_discount_amount(p_quote.subtotal, p_quote.discount_type, p_quote.discount_value),
      2
    ),
    0
  );
$$;

COMMENT ON FUNCTION public.quick_quote_display_total (public.quick_quotes) IS
  'Subtotal minus discount. quick_quotes.total is whatever the client stored; this is the authoritative computed total.';

-- ─── 7) Conversion: quick quote -> job ────────────────────────────────────────

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS quick_quote_id uuid REFERENCES public.quick_quotes(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.jobs.quick_quote_id IS
  'Source quick quote when this job was converted from a quick quote.';

-- A job still comes from at most one source record.
ALTER TABLE public.jobs
  DROP CONSTRAINT IF EXISTS jobs_single_source_check;

ALTER TABLE public.jobs
  ADD CONSTRAINT jobs_single_source_check
  CHECK (num_nonnulls(estimate_id, walkthrough_id, quick_quote_id) <= 1);

CREATE UNIQUE INDEX IF NOT EXISTS uq_jobs_quick_quote_id
  ON public.jobs(quick_quote_id)
  WHERE quick_quote_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_quick_quotes_job_id
  ON public.quick_quotes(job_id)
  WHERE job_id IS NOT NULL;

-- Ownership guards, same shape as estimates/walkthroughs.
CREATE OR REPLACE FUNCTION public.enforce_quick_quote_job_same_owner ()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.job_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.jobs j
      WHERE j.id = NEW.job_id
        AND j.user_id = NEW.user_id
    ) THEN
      RAISE EXCEPTION 'quick_quotes.job_id must reference a job owned by the same user';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_enforce_quick_quote_job_owner ON public.quick_quotes;
CREATE TRIGGER tr_enforce_quick_quote_job_owner
  BEFORE INSERT OR UPDATE OF job_id, user_id ON public.quick_quotes
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_quick_quote_job_same_owner ();

-- Extend the job-side guard with the new source column.
CREATE OR REPLACE FUNCTION public.enforce_job_source_same_owner ()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.estimate_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.estimates e
      WHERE e.id = NEW.estimate_id
        AND e.user_id = NEW.user_id
    ) THEN
      RAISE EXCEPTION 'jobs.estimate_id must reference an estimate owned by the same user';
    END IF;
  END IF;

  IF NEW.walkthrough_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.walkthroughs w
      WHERE w.id = NEW.walkthrough_id
        AND w.user_id = NEW.user_id
    ) THEN
      RAISE EXCEPTION 'jobs.walkthrough_id must reference a walkthrough owned by the same user';
    END IF;
  END IF;

  IF NEW.quick_quote_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.quick_quotes q
      WHERE q.id = NEW.quick_quote_id
        AND q.user_id = NEW.user_id
    ) THEN
      RAISE EXCEPTION 'jobs.quick_quote_id must reference a quick quote owned by the same user';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_enforce_job_source_owner ON public.jobs;
CREATE TRIGGER tr_enforce_job_source_owner
  BEFORE INSERT OR UPDATE OF estimate_id, walkthrough_id, quick_quote_id, user_id ON public.jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_job_source_same_owner ();

-- Atomic RPC, mirrors finalize_estimate_to_job_conversion.
CREATE OR REPLACE FUNCTION public.finalize_quick_quote_to_job_conversion (
  p_quick_quote_id uuid,
  p_job_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_quote record;
  v_job record;
  v_rows int;
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
  IF v_quote.job_id IS NOT NULL AND v_quote.job_id IS DISTINCT FROM p_job_id THEN
    RAISE EXCEPTION 'Quick quote is already linked to another job';
  END IF;

  SELECT * INTO v_job
  FROM public.jobs
  WHERE id = p_job_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job not found';
  END IF;
  IF v_job.user_id <> v_uid THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  IF v_job.quick_quote_id IS NOT NULL AND v_job.quick_quote_id IS DISTINCT FROM p_quick_quote_id THEN
    RAISE EXCEPTION 'Job is already linked to another quick quote';
  END IF;
  IF v_job.estimate_id IS NOT NULL OR v_job.walkthrough_id IS NOT NULL THEN
    RAISE EXCEPTION 'Job is already linked to another source; only one source is allowed';
  END IF;

  UPDATE public.jobs
  SET quick_quote_id = p_quick_quote_id
  WHERE id = p_job_id
    AND user_id = v_uid;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'Failed to link job to quick quote';
  END IF;

  UPDATE public.quick_quotes
  SET
    job_id = p_job_id,
    status = 'Converted',
    is_draft = false
  WHERE id = p_quick_quote_id
    AND user_id = v_uid;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'Failed to mark quick quote as converted';
  END IF;

  RETURN jsonb_build_object(
    'job_id', p_job_id,
    'quick_quote_id', p_quick_quote_id,
    'job', (SELECT to_jsonb(j.*) FROM public.jobs j WHERE j.id = p_job_id),
    'quick_quote', (SELECT to_jsonb(q.*) FROM public.quick_quotes q WHERE q.id = p_quick_quote_id)
  );
END;
$$;

COMMENT ON FUNCTION public.finalize_quick_quote_to_job_conversion (uuid, uuid) IS
  'Atomic conversion: links quick quote to job both ways and marks the quote status as Converted.';

GRANT EXECUTE ON FUNCTION public.finalize_quick_quote_to_job_conversion (uuid, uuid) TO authenticated;

-- ─── 8) Job prefill payload ───────────────────────────────────────────────────
-- Same mapping the dashboard applies when converting an estimate: one line item
-- priced at the quote subtotal, discount carried over, no tax, no deposit.

CREATE OR REPLACE FUNCTION public.get_quick_quote_job_prefill (p_quick_quote_id uuid)
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
  v_discount_amount numeric;
  v_total numeric;
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
    WHEN lower(COALESCE(v_quote.discount_type, '')) IN ('percent', 'percentage') THEN 'percent'
    ELSE 'amount'
  END;
  v_discount_amount := public.quick_quote_discount_amount(v_subtotal, v_quote.discount_type, v_discount_value);
  v_total := public.quick_quote_display_total(v_quote);

  RETURN jsonb_build_object(
    'quick_quote_id', v_quote.id,
    'client_name', v_quote.recipient_name,
    'client_email', v_quote.recipient_email,
    'client_phone', v_quote.recipient_phone,
    'service_type', lower(COALESCE(NULLIF(btrim(v_quote.service_type), ''), 'residential')),
    'job_type', 'one_time',
    'selected_week_days', '[]'::jsonb,
    'assigned_employees', '[]'::jsonb,
    'scheduled_date', COALESCE(v_quote.quote_date, CURRENT_DATE),
    'service_details', COALESCE(v_quote.service_scope, ''),
    'line_items', jsonb_build_array(
      jsonb_build_object(
        'name', COALESCE(
          NULLIF(btrim(v_quote.service_sub_type), ''),
          NULLIF(btrim(v_quote.service_type), ''),
          'Cleaning Service'
        ),
        'quantity', 1,
        'unit_price', v_subtotal,
        'description', COALESCE(v_quote.service_scope, '')
      )
    ),
    'subtotal', v_subtotal,
    'discount_type', CASE WHEN v_discount_value > 0 THEN v_discount_type ELSE 'amount' END,
    'discount_value', CASE WHEN v_discount_value > 0 THEN v_discount_value ELSE 0 END,
    'discount_amount', v_discount_amount,
    'tax_type', 'percent',
    'tax_value', 0,
    'tax_amount', 0,
    'total_amount', v_total,
    'deposit_required', false,
    'amount_paid', 0,
    'balance_due', v_total,
    'payment_status', 'no_deposit_required',
    'status', 'draft',
    'main_data', COALESCE(v_quote.main_data, '{}'::jsonb),
    'additional_data', COALESCE(v_quote.additional_data, '{}'::jsonb),
    'additional_items', COALESCE(v_quote.additional_items, '[]'::jsonb),
    'extra_services', COALESCE(v_quote.extra_services, '{}'::jsonb),
    'pets', v_quote.pets,
    'laundry', v_quote.laundry
  );
END;
$$;

COMMENT ON FUNCTION public.get_quick_quote_job_prefill (uuid) IS
  'Returns a ready-to-insert jobs payload derived from a quick quote. RLS applies: owner only. Client/property fields are left to the user.';

GRANT EXECUTE ON FUNCTION public.get_quick_quote_job_prefill (uuid) TO authenticated;

-- ─── 9) PostgREST schema reload ───────────────────────────────────────────────

NOTIFY pgrst, 'reload schema';
