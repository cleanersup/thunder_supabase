-- When an invoice becomes Paid (Stripe, manual mark, process-invoice-payment, etc.),
-- notify client + merchant via send-invoice-email (isPaymentConfirmation).
-- Uses pg_net after commit (same pattern as employee welcome SMS).

CREATE OR REPLACE FUNCTION public.notify_invoice_paid_send_confirmation_email()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  request_id bigint;
  function_url text;
BEGIN
  function_url := current_setting('app.settings.supabase_url', true) ||
    '/functions/v1/send-invoice-email';

  IF function_url IS NULL OR function_url = '' THEN
    function_url := 'https://euydrdzayvjahstvmwoj.supabase.co/functions/v1/send-invoice-email';
  END IF;

  SELECT net.http_post(
    url := function_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body := jsonb_build_object(
      'invoiceId', NEW.id::text,
      'isPaymentConfirmation', true
    )
  ) INTO request_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_invoice_marked_paid_send_confirmation ON public.invoices;

CREATE TRIGGER on_invoice_marked_paid_send_confirmation
  AFTER UPDATE OF status ON public.invoices
  FOR EACH ROW
  WHEN (NEW.status = 'Paid' AND OLD.status IS DISTINCT FROM 'Paid')
  EXECUTE FUNCTION public.notify_invoice_paid_send_confirmation_email();

COMMENT ON FUNCTION public.notify_invoice_paid_send_confirmation_email() IS
  'Queues send-invoice-email with isPaymentConfirmation when status transitions to Paid.';
