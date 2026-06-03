-- Balance due must subtract required deposit while deposit is unpaid (matches AddJob: total - depositAmount).
CREATE OR REPLACE FUNCTION public.compute_job_financials ()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_subtotal numeric(12,2) := 0;
  v_discount numeric(12,2) := 0;
  v_tax_base numeric(12,2) := 0;
  v_tax numeric(12,2) := 0;
  v_total numeric(12,2) := 0;
  v_deposit numeric(12,2) := 0;
  v_balance numeric(12,2) := 0;
BEGIN
  IF jsonb_typeof(NEW.line_items) = 'array' AND COALESCE(NEW.subtotal, 0) = 0 THEN
    SELECT
      COALESCE(SUM(
        COALESCE(NULLIF(item->>'quantity', '')::numeric, 0)
        * COALESCE(NULLIF(item->>'unit_price', '')::numeric, 0)
      ), 0)
    INTO v_subtotal
    FROM jsonb_array_elements(NEW.line_items) item;
  ELSE
    v_subtotal := COALESCE(NEW.subtotal, 0);
  END IF;

  IF NEW.discount_type = 'percent' THEN
    v_discount := ROUND(v_subtotal * COALESCE(NEW.discount_value, 0) / 100.0, 2);
  ELSE
    v_discount := COALESCE(NEW.discount_value, 0);
  END IF;

  v_tax_base := GREATEST(v_subtotal - v_discount, 0);

  IF NEW.tax_type = 'percent' THEN
    v_tax := ROUND(v_tax_base * COALESCE(NEW.tax_value, 0) / 100.0, 2);
  ELSE
    v_tax := COALESCE(NEW.tax_value, 0);
  END IF;

  v_total := ROUND(v_tax_base + v_tax, 2);

  IF COALESCE(NEW.deposit_required, false) THEN
    IF NEW.deposit_type = 'percent' THEN
      v_deposit := ROUND(v_total * COALESCE(NEW.deposit_value, 0) / 100.0, 2);
    ELSE
      v_deposit := COALESCE(NEW.deposit_value, 0);
    END IF;
  ELSE
    v_deposit := 0;
  END IF;

  NEW.subtotal := ROUND(v_subtotal, 2);
  NEW.discount_amount := ROUND(v_discount, 2);
  NEW.tax_amount := ROUND(v_tax, 2);
  NEW.total_amount := ROUND(v_total, 2);
  NEW.deposit_amount := ROUND(v_deposit, 2);

  v_balance := v_total - COALESCE(NEW.amount_paid, 0);
  IF COALESCE(NEW.deposit_required, false) AND COALESCE(NEW.amount_paid, 0) < v_deposit THEN
    v_balance := v_total - v_deposit;
  END IF;
  NEW.balance_due := ROUND(GREATEST(v_balance, 0), 2);

  IF COALESCE(NEW.amount_paid, 0) >= v_total AND v_total > 0 THEN
    NEW.payment_status := 'payment_completed';
  ELSIF COALESCE(NEW.deposit_required, false) = false THEN
    IF COALESCE(NEW.amount_paid, 0) > 0 THEN
      NEW.payment_status := 'balance_due';
    ELSE
      NEW.payment_status := 'no_deposit_required';
    END IF;
  ELSIF COALESCE(NEW.amount_paid, 0) < v_deposit THEN
    NEW.payment_status := 'pending_deposit';
  ELSIF COALESCE(NEW.amount_paid, 0) >= v_deposit AND COALESCE(NEW.amount_paid, 0) < v_total THEN
    NEW.payment_status := 'deposit_paid';
  ELSE
    NEW.payment_status := 'balance_due';
  END IF;

  RETURN NEW;
END;
$$;

-- Recompute balance_due for existing jobs with unpaid deposit.
UPDATE public.jobs j
SET balance_due = ROUND(
  GREATEST(
    j.total_amount
    - CASE
        WHEN COALESCE(j.deposit_required, false) AND COALESCE(j.amount_paid, 0) < j.deposit_amount
          THEN j.deposit_amount
        ELSE COALESCE(j.amount_paid, 0)
      END,
    0
  ),
  2
)
WHERE COALESCE(j.deposit_required, false)
  AND COALESCE(j.amount_paid, 0) < COALESCE(j.deposit_amount, 0);
