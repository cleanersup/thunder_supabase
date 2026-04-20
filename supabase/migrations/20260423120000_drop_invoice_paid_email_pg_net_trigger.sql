-- Paid-invoice emails are invoked explicitly from edge functions and apps (send-invoice-email).
-- Remove pg_net trigger to avoid duplicate sends and to avoid depending on app.settings / Kong URL.

DROP TRIGGER IF EXISTS on_invoice_marked_paid_send_confirmation ON public.invoices;

DROP FUNCTION IF EXISTS public.notify_invoice_paid_send_confirmation_email();
