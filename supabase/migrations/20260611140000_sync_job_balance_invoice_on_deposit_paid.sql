-- When a job deposit invoice is marked Paid, sync jobs.amount_paid and adjust the
-- final/balance job invoice if it was created at full total before the deposit was paid.

CREATE OR REPLACE FUNCTION public.sync_job_on_deposit_invoice_paid()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.jobs%ROWTYPE;
  v_final_invoice_id uuid;
  v_final_invoice public.invoices%ROWTYPE;
  v_balance_total numeric(12, 2);
  v_line_items jsonb;
  v_deposit_line_exists boolean;
  v_job_label text;
BEGIN
  IF NEW.status <> 'Paid' OR OLD.status = 'Paid' THEN
    RETURN NEW;
  END IF;

  SELECT *
  INTO v_job
  FROM public.jobs j
  WHERE j.deposit_invoice_id = NEW.id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  v_job_label := COALESCE(NULLIF(v_job.job_number, ''), LEFT(v_job.id::text, 8));
  v_balance_total := GREATEST(COALESCE(v_job.total_amount, 0) - COALESCE(v_job.deposit_amount, 0), 0);

  UPDATE public.jobs
  SET amount_paid = GREATEST(
    COALESCE(amount_paid, 0),
    COALESCE(NEW.total, 0),
    COALESCE(v_job.deposit_amount, 0)
  )
  WHERE id = v_job.id;

  SELECT inv_id
  INTO v_final_invoice_id
  FROM unnest(COALESCE(v_job.invoice_ids, '{}'::uuid[])) AS inv_id
  WHERE inv_id IS DISTINCT FROM v_job.deposit_invoice_id
  LIMIT 1;

  IF v_final_invoice_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT *
  INTO v_final_invoice
  FROM public.invoices i
  WHERE i.id = v_final_invoice_id
    AND i.user_id = v_job.user_id;

  IF NOT FOUND OR v_final_invoice.status IN ('Paid', 'Cancelled') THEN
    RETURN NEW;
  END IF;

  IF ABS(COALESCE(v_final_invoice.total, 0) - v_balance_total) < 0.01 THEN
    SELECT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(COALESCE(v_final_invoice.line_items, '[]'::jsonb)) AS item
      WHERE COALESCE(item->>'description', '') ILIKE 'Deposit Paid%'
    ) INTO v_deposit_line_exists;

    IF v_deposit_line_exists THEN
      RETURN NEW;
    END IF;
  END IF;

  v_line_items := COALESCE(v_final_invoice.line_items, '[]'::jsonb);

  SELECT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_line_items) AS item
    WHERE COALESCE(item->>'description', '') ILIKE 'Deposit Paid%'
  ) INTO v_deposit_line_exists;

  IF NOT v_deposit_line_exists THEN
    v_line_items := v_line_items || jsonb_build_array(
      jsonb_build_object(
        'description', 'Deposit Paid – ' || COALESCE(NEW.invoice_number, 'Deposit'),
        'price', -COALESCE(v_job.deposit_amount, 0),
        'qty', 1,
        'quantity', 1,
        'total', -COALESCE(v_job.deposit_amount, 0)
      )
    );
  END IF;

  UPDATE public.invoices
  SET
    total = v_balance_total,
    line_items = v_line_items,
    invoice_name = CASE
      WHEN invoice_name ILIKE 'Invoice –%' THEN 'Balance – ' || v_job_label
      ELSE invoice_name
    END,
    notes = CASE
      WHEN notes ILIKE '%Deposit of $%' THEN notes
      ELSE 'Final balance for ' || v_job_label
        || '. Deposit of $' || COALESCE(v_job.deposit_amount, 0)::text || ' was previously paid.'
    END
  WHERE id = v_final_invoice_id
    AND user_id = v_job.user_id
    AND status NOT IN ('Paid', 'Cancelled');

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_job_on_deposit_invoice_paid ON public.invoices;

CREATE TRIGGER trg_sync_job_on_deposit_invoice_paid
  AFTER UPDATE OF status ON public.invoices
  FOR EACH ROW
  WHEN (NEW.status = 'Paid' AND OLD.status IS DISTINCT FROM 'Paid')
  EXECUTE FUNCTION public.sync_job_on_deposit_invoice_paid();

COMMENT ON FUNCTION public.sync_job_on_deposit_invoice_paid() IS
  'When a job deposit invoice becomes Paid, updates jobs.amount_paid and reconciles an existing final job invoice to the balance amount.';

-- Backfill jobs where deposit is already Paid but the final invoice still shows the full total.
DO $$
DECLARE
  v_row RECORD;
  v_balance_total numeric(12, 2);
  v_line_items jsonb;
  v_deposit_line_exists boolean;
  v_job_label text;
BEGIN
  FOR v_row IN
    SELECT
      j.id AS job_id,
      j.job_number,
      j.user_id,
      j.total_amount,
      j.deposit_amount,
      di.invoice_number AS deposit_invoice_number,
      fi.id AS final_invoice_id,
      fi.total AS final_invoice_total,
      fi.line_items AS final_invoice_line_items,
      fi.invoice_name AS final_invoice_name,
      fi.notes AS final_invoice_notes
    FROM public.jobs j
    INNER JOIN public.invoices di
      ON di.id = j.deposit_invoice_id
      AND di.status = 'Paid'
    CROSS JOIN LATERAL (
      SELECT inv.id, inv.total, inv.line_items, inv.invoice_name, inv.notes, inv.status
      FROM unnest(COALESCE(j.invoice_ids, '{}'::uuid[])) AS inv_id
      INNER JOIN public.invoices inv ON inv.id = inv_id
      WHERE inv_id IS DISTINCT FROM j.deposit_invoice_id
        AND inv.status NOT IN ('Paid', 'Cancelled')
      LIMIT 1
    ) AS fi
    WHERE COALESCE(j.deposit_required, false)
      AND ABS(COALESCE(fi.total, 0) - GREATEST(COALESCE(j.total_amount, 0) - COALESCE(j.deposit_amount, 0), 0)) >= 0.01
  LOOP
    v_job_label := COALESCE(NULLIF(v_row.job_number, ''), LEFT(v_row.job_id::text, 8));
    v_balance_total := GREATEST(COALESCE(v_row.total_amount, 0) - COALESCE(v_row.deposit_amount, 0), 0);
    v_line_items := COALESCE(v_row.final_invoice_line_items, '[]'::jsonb);

    SELECT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(v_line_items) AS item
      WHERE COALESCE(item->>'description', '') ILIKE 'Deposit Paid%'
    ) INTO v_deposit_line_exists;

    IF NOT v_deposit_line_exists THEN
      v_line_items := v_line_items || jsonb_build_array(
        jsonb_build_object(
          'description', 'Deposit Paid – ' || COALESCE(v_row.deposit_invoice_number, 'Deposit'),
          'price', -COALESCE(v_row.deposit_amount, 0),
          'qty', 1,
          'quantity', 1,
          'total', -COALESCE(v_row.deposit_amount, 0)
        )
      );
    END IF;

    UPDATE public.jobs
    SET amount_paid = GREATEST(
      COALESCE(amount_paid, 0),
      COALESCE(v_row.deposit_amount, 0)
    )
    WHERE id = v_row.job_id;

    UPDATE public.invoices
    SET
      total = v_balance_total,
      line_items = v_line_items,
      invoice_name = CASE
        WHEN v_row.final_invoice_name ILIKE 'Invoice –%' THEN 'Balance – ' || v_job_label
        ELSE v_row.final_invoice_name
      END,
      notes = CASE
        WHEN v_row.final_invoice_notes ILIKE '%Deposit of $%' THEN v_row.final_invoice_notes
        ELSE 'Final balance for ' || v_job_label
          || '. Deposit of $' || COALESCE(v_row.deposit_amount, 0)::text || ' was previously paid.'
      END
    WHERE id = v_row.final_invoice_id
      AND user_id = v_row.user_id
      AND status NOT IN ('Paid', 'Cancelled');
  END LOOP;
END;
$$;
