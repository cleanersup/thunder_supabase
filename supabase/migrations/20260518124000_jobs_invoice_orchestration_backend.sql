-- Jobs invoice orchestration (backend-owned)
-- Implements:
-- 1) On status -> upcoming: create deposit invoice (Draft) when applicable.
-- 2) On status -> completed: create final invoice as Balance or Full based on
--    current deposit invoice status at completion time.
-- 3) On status -> cancelled: cancel deposit invoice automatically.
--
-- Rule parity with frontend spec:
-- - Decision at completion depends on invoices.status of jobs.deposit_invoice_id.
-- - NOT on apply_deposit flags.

-- 1) Schema support on jobs
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS deposit_invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS invoice_ids uuid[] NOT NULL DEFAULT '{}'::uuid[];

COMMENT ON COLUMN public.jobs.deposit_invoice_id IS
  'Pointer to the deposit invoice created for this job when published (status upcoming).';

COMMENT ON COLUMN public.jobs.invoice_ids IS
  'All invoice IDs linked to this job (deposit + final).';

CREATE INDEX IF NOT EXISTS idx_jobs_deposit_invoice_id
  ON public.jobs(deposit_invoice_id)
  WHERE deposit_invoice_id IS NOT NULL;

-- 2) Helper sequence for backend-created job invoices
CREATE SEQUENCE IF NOT EXISTS public.job_invoice_number_seq START 1;

CREATE OR REPLACE FUNCTION public.generate_job_invoice_number ()
RETURNS text
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN 'JINV-' || LPAD(nextval('public.job_invoice_number_seq')::text, 6, '0');
END;
$$;

COMMENT ON FUNCTION public.generate_job_invoice_number () IS
'Generates invoice numbers for backend-created job invoices.';

-- 3) Core orchestration on status transitions
CREATE OR REPLACE FUNCTION public.orchestrate_job_invoices_on_status_change ()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_invoice_ids uuid[] := COALESCE(NEW.invoice_ids, '{}'::uuid[]);
  v_deposit_invoice_id uuid := NEW.deposit_invoice_id;
  v_deposit_status text;
  v_deposit_paid boolean := false;
  v_final_invoice_exists boolean := false;
  v_new_invoice_id uuid;
  v_job_label text := COALESCE(NULLIF(NEW.job_number, ''), LEFT(NEW.id::text, 8));
  v_invoice_total numeric(12,2);
  v_company_name text;
  v_line_items jsonb;
  v_deposit_invoice_number text;
  v_discount_type text;
  v_discount_value numeric(12,2);
  v_tax_rate numeric(12,2);
BEGIN
  -- 3.1) Publish: upcoming => create deposit invoice if configured and missing
  IF NEW.status = 'upcoming' AND OLD.status IS DISTINCT FROM NEW.status THEN
    IF COALESCE(NEW.deposit_required, false) = true
       AND COALESCE(NEW.deposit_amount, 0) > 0
       AND v_deposit_invoice_id IS NULL THEN
      SELECT p.company_name
      INTO v_company_name
      FROM public.profiles p
      WHERE p.user_id = NEW.user_id
      LIMIT 1;

      INSERT INTO public.invoices (
        user_id,
        invoice_number,
        client_name,
        company_name,
        email,
        phone,
        address,
        apt,
        city,
        state,
        zip,
        service_type,
        total,
        status,
        invoice_date,
        due_date,
        invoice_name,
        notes,
        line_items,
        discount_type,
        discount_value,
        tax_rate
      ) VALUES (
        NEW.user_id,
        public.generate_job_invoice_number(),
        COALESCE(NULLIF(NEW.client_name, ''), 'Client'),
        v_company_name,
        COALESCE(NULLIF(NEW.client_email, ''), 'no-email@thunderpro.local'),
        COALESCE(NULLIF(NEW.client_phone, ''), 'N/A'),
        COALESCE(NULLIF(NEW.property_street, ''), 'N/A'),
        NULLIF(NEW.property_apt, ''),
        COALESCE(NULLIF(NEW.property_city, ''), 'N/A'),
        COALESCE(NULLIF(NEW.property_state, ''), 'N/A'),
        COALESCE(NULLIF(NEW.property_zip, ''), 'N/A'),
        NEW.service_type,
        NEW.deposit_amount,
        'Draft',
        CURRENT_DATE,
        CURRENT_DATE,
        'Deposit – ' || v_job_label,
        'Deposit invoice for ' || v_job_label || '.',
        jsonb_build_array(
          jsonb_build_object(
            'name', 'Deposit – ' || v_job_label,
            'quantity', 1,
            'unit_price', NEW.deposit_amount,
            'total', NEW.deposit_amount
          )
        ),
        NULL,
        NULL,
        NULL
      )
      RETURNING id INTO v_new_invoice_id;

      v_deposit_invoice_id := v_new_invoice_id;

      IF NOT (v_new_invoice_id = ANY(v_invoice_ids)) THEN
        v_invoice_ids := array_append(v_invoice_ids, v_new_invoice_id);
      END IF;

      UPDATE public.jobs
      SET
        deposit_invoice_id = v_deposit_invoice_id,
        invoice_ids = v_invoice_ids
      WHERE id = NEW.id;
    END IF;
  END IF;

  -- 3.2) Complete: create final invoice based on current deposit invoice status
  IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM NEW.status THEN
    -- Avoid duplicate final invoices if job cycles status multiple times.
    SELECT EXISTS (
      SELECT 1
      FROM unnest(COALESCE(NEW.invoice_ids, '{}'::uuid[])) AS inv_id
      WHERE inv_id IS DISTINCT FROM COALESCE(NEW.deposit_invoice_id, '00000000-0000-0000-0000-000000000000'::uuid)
    ) INTO v_final_invoice_exists;

    IF NOT v_final_invoice_exists THEN
      SELECT p.company_name
      INTO v_company_name
      FROM public.profiles p
      WHERE p.user_id = NEW.user_id
      LIMIT 1;

      IF NEW.deposit_invoice_id IS NOT NULL THEN
        SELECT i.status
        INTO v_deposit_status
        FROM public.invoices i
        WHERE i.id = NEW.deposit_invoice_id
          AND i.user_id = NEW.user_id
        LIMIT 1;

        v_deposit_paid := (v_deposit_status = 'Paid');

        IF COALESCE(v_deposit_status, '') IN ('Draft', 'Pending', 'Cancelled') THEN
          UPDATE public.invoices
          SET status = 'Cancelled'
          WHERE id = NEW.deposit_invoice_id
            AND user_id = NEW.user_id
            AND status IS DISTINCT FROM 'Cancelled';
        END IF;
      END IF;

      IF v_deposit_paid THEN
        v_invoice_total := GREATEST(COALESCE(NEW.total_amount, 0) - COALESCE(NEW.deposit_amount, 0), 0);

        SELECT inv.invoice_number
        INTO v_deposit_invoice_number
        FROM public.invoices inv
        WHERE inv.id = NEW.deposit_invoice_id
        LIMIT 1;

        v_line_items := COALESCE(NEW.line_items, '[]'::jsonb)
          || jsonb_build_array(
            jsonb_build_object(
              'name', 'Deposit Paid – ' || COALESCE(v_deposit_invoice_number, 'Deposit'),
              'quantity', 1,
              'unit_price', -COALESCE(NEW.deposit_amount, 0),
              'total', -COALESCE(NEW.deposit_amount, 0)
            )
          );
      ELSE
        v_invoice_total := COALESCE(NEW.total_amount, 0);
        v_line_items := COALESCE(NEW.line_items, '[]'::jsonb);
      END IF;

      v_discount_type := CASE NEW.discount_type
        WHEN 'percent' THEN 'percentage'
        ELSE NEW.discount_type
      END;
      v_discount_value := NEW.discount_value;
      v_tax_rate := NEW.tax_value;

      INSERT INTO public.invoices (
        user_id,
        invoice_number,
        client_name,
        company_name,
        email,
        phone,
        address,
        apt,
        city,
        state,
        zip,
        service_type,
        total,
        status,
        invoice_date,
        due_date,
        invoice_name,
        notes,
        line_items,
        discount_type,
        discount_value,
        tax_rate
      ) VALUES (
        NEW.user_id,
        public.generate_job_invoice_number(),
        COALESCE(NULLIF(NEW.client_name, ''), 'Client'),
        v_company_name,
        COALESCE(NULLIF(NEW.client_email, ''), 'no-email@thunderpro.local'),
        COALESCE(NULLIF(NEW.client_phone, ''), 'N/A'),
        COALESCE(NULLIF(NEW.property_street, ''), 'N/A'),
        NULLIF(NEW.property_apt, ''),
        COALESCE(NULLIF(NEW.property_city, ''), 'N/A'),
        COALESCE(NULLIF(NEW.property_state, ''), 'N/A'),
        COALESCE(NULLIF(NEW.property_zip, ''), 'N/A'),
        NEW.service_type,
        v_invoice_total,
        'Draft',
        CURRENT_DATE,
        CURRENT_DATE,
        CASE WHEN v_deposit_paid
          THEN 'Balance – ' || v_job_label
          ELSE 'Invoice – ' || v_job_label
        END,
        CASE WHEN v_deposit_paid
          THEN 'Final balance for ' || v_job_label || '. Deposit of $' || COALESCE(NEW.deposit_amount, 0)::text || ' was previously paid.'
          ELSE 'Invoice for completed job ' || v_job_label || '.'
        END,
        v_line_items,
        v_discount_type,
        v_discount_value,
        v_tax_rate
      )
      RETURNING id INTO v_new_invoice_id;

      v_invoice_ids := COALESCE(NEW.invoice_ids, '{}'::uuid[]);
      IF NOT (v_new_invoice_id = ANY(v_invoice_ids)) THEN
        v_invoice_ids := array_append(v_invoice_ids, v_new_invoice_id);
      END IF;

      UPDATE public.jobs
      SET invoice_ids = v_invoice_ids
      WHERE id = NEW.id;
    END IF;
  END IF;

  -- 3.3) Cancel: cancel deposit invoice automatically
  IF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM NEW.status THEN
    IF NEW.deposit_invoice_id IS NOT NULL THEN
      UPDATE public.invoices
      SET status = 'Cancelled'
      WHERE id = NEW.deposit_invoice_id
        AND user_id = NEW.user_id
        AND status IS DISTINCT FROM 'Cancelled';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.orchestrate_job_invoices_on_status_change () IS
'Orchestrates job deposit/final invoice creation and cancellation on status changes. Deposit invoices use a single summary line item; balance invoices append a negative deposit line; full invoices copy job line items with discount/tax.';

DROP TRIGGER IF EXISTS tr_orchestrate_job_invoices_on_status_change ON public.jobs;
CREATE TRIGGER tr_orchestrate_job_invoices_on_status_change
  AFTER UPDATE OF status ON public.jobs
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.orchestrate_job_invoices_on_status_change();
