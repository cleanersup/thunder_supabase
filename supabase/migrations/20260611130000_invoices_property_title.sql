-- Store client property label on invoices (e.g. "Second address", "Primary property")

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS property_title text;

COMMENT ON COLUMN public.invoices.property_title IS
  'Display label for the service property (from client_properties.title or default). Street/city remain in address fields.';

CREATE OR REPLACE FUNCTION public.resolve_client_property_title (
  p_client_id uuid,
  p_street text,
  p_city text,
  p_zip text
) RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN NULLIF(TRIM(cp.title), '') IS NOT NULL THEN TRIM(cp.title)
    WHEN cp.is_primary THEN 'Primary property'
    ELSE 'Address'
  END
  FROM public.client_properties cp
  WHERE cp.client_id = p_client_id
    AND COALESCE(cp.is_active, true) = true
    AND lower(trim(cp.street)) = lower(trim(COALESCE(p_street, '')))
    AND lower(trim(cp.city)) = lower(trim(COALESCE(p_city, '')))
    AND trim(cp.zip_code) = trim(COALESCE(p_zip, ''))
  ORDER BY cp.is_primary DESC, cp.created_at ASC
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.resolve_client_property_title IS
  'Resolves a human-readable property label from client_properties by matching job/invoice address.';

-- Job → invoice orchestration: persist property title alongside street address
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
  v_property_title text;
BEGIN
  v_property_title := public.resolve_client_property_title(
    NEW.client_id,
    NEW.property_street,
    NEW.property_city,
    NEW.property_zip
  );

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
        property_title,
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
        v_property_title,
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
            'description', 'Deposit – ' || v_job_label,
            'price', NEW.deposit_amount,
            'qty', 1,
            'quantity', 1,
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

  IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM NEW.status THEN
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

      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'description', COALESCE(NULLIF(item->>'name', ''), NULLIF(item->>'description', ''), 'Service'),
          'price', COALESCE(NULLIF(item->>'unit_price', '')::numeric, NULLIF(item->>'price', '')::numeric, 0),
          'qty', COALESCE(NULLIF(item->>'quantity', '')::numeric, NULLIF(item->>'qty', '')::numeric, 0),
          'quantity', COALESCE(NULLIF(item->>'quantity', '')::numeric, NULLIF(item->>'qty', '')::numeric, 0),
          'total', COALESCE(
            NULLIF(item->>'total', '')::numeric,
            COALESCE(NULLIF(item->>'quantity', '')::numeric, NULLIF(item->>'qty', '')::numeric, 0)
              * COALESCE(NULLIF(item->>'unit_price', '')::numeric, NULLIF(item->>'price', '')::numeric, 0)
          )
        )
      ), '[]'::jsonb)
      INTO v_line_items
      FROM jsonb_array_elements(COALESCE(NEW.line_items, '[]'::jsonb)) AS item;

      IF v_deposit_paid THEN
        v_invoice_total := GREATEST(COALESCE(NEW.total_amount, 0) - COALESCE(NEW.deposit_amount, 0), 0);

        SELECT inv.invoice_number
        INTO v_deposit_invoice_number
        FROM public.invoices inv
        WHERE inv.id = NEW.deposit_invoice_id
        LIMIT 1;

        v_line_items := v_line_items
          || jsonb_build_array(
            jsonb_build_object(
              'description', 'Deposit Paid – ' || COALESCE(v_deposit_invoice_number, 'Deposit'),
              'price', -COALESCE(NEW.deposit_amount, 0),
              'qty', 1,
              'quantity', 1,
              'total', -COALESCE(NEW.deposit_amount, 0)
            )
          );
      ELSE
        v_invoice_total := COALESCE(NEW.total_amount, 0);
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
        property_title,
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
        v_property_title,
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
