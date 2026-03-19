-- Add reminder_sent column to invoices table to track if due date reminder has been sent
ALTER TABLE public.invoices 
ADD COLUMN IF NOT EXISTS reminder_sent boolean NOT NULL DEFAULT false;

-- Create index for better performance when querying unpaid invoices due today
CREATE INDEX IF NOT EXISTS idx_invoices_due_date_status ON public.invoices(due_date, status, reminder_sent);

-- Create trigger to reset reminder_sent when invoice is paid or due_date changes
CREATE OR REPLACE FUNCTION public.reset_invoice_reminder()
RETURNS TRIGGER AS $$
BEGIN
  -- Reset reminder_sent when status changes to paid
  IF NEW.status = 'paid' AND OLD.status != 'paid' THEN
    NEW.reminder_sent = false;
  END IF;
  
  -- Reset reminder_sent when due_date changes
  IF NEW.due_date != OLD.due_date THEN
    NEW.reminder_sent = false;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Create trigger for automatic reminder_sent reset
DROP TRIGGER IF EXISTS trigger_reset_invoice_reminder ON public.invoices;
CREATE TRIGGER trigger_reset_invoice_reminder
  BEFORE UPDATE ON public.invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.reset_invoice_reminder();