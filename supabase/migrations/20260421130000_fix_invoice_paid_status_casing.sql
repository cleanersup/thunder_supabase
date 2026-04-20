-- Invoice status values in DB are title-case per invoices_status_check ('Paid', 'Pending', etc.).
-- Several triggers and edge functions used lowercase 'paid', which broke:
-- - process-invoice-payment updates (CHECK violation)
-- - reminder / daily report queries (no rows matched)
-- - log_invoice_activity / reset_invoice_reminder (conditions never true)
-- Also allow 'Refunded' so stripe-webhook charge.refunded updates do not violate CHECK.

ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_status_check;

ALTER TABLE public.invoices ADD CONSTRAINT invoices_status_check CHECK (
  status IN ('Paid', 'Pending', 'Draft', 'Cancelled', 'Refunded')
);

CREATE OR REPLACE FUNCTION public.reset_invoice_reminder()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'Paid' AND OLD.status IS DISTINCT FROM 'Paid' THEN
    NEW.reminder_sent = false;
  END IF;

  IF NEW.due_date IS DISTINCT FROM OLD.due_date THEN
    NEW.reminder_sent = false;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.log_invoice_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO activities (user_id, type, title, invoice_number, client_name, amount)
    VALUES (
      NEW.user_id,
      'invoice_created',
      'Invoice ' || NEW.invoice_number || ' created for ' || NEW.client_name,
      NEW.invoice_number,
      NEW.client_name,
      NEW.total
    );
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM 'Paid' AND NEW.status = 'Paid' THEN
    INSERT INTO activities (user_id, type, title, invoice_number, client_name, amount)
    VALUES (
      NEW.user_id,
      'invoice_paid',
      'Invoice ' || NEW.invoice_number || ' paid by ' || NEW.client_name || ' ($' || NEW.total || ')',
      NEW.invoice_number,
      NEW.client_name,
      NEW.total
    );
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM 'Cancelled' AND NEW.status = 'Cancelled' THEN
    INSERT INTO activities (user_id, type, title, invoice_number, client_name, amount)
    VALUES (
      NEW.user_id,
      'invoice_canceled',
      'Invoice ' || NEW.invoice_number || ' canceled',
      NEW.invoice_number,
      NEW.client_name,
      NEW.total
    );
  END IF;

  RETURN NEW;
END;
$$;
