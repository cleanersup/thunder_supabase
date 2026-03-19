-- Add line_items column to invoices table to store invoice line items details
ALTER TABLE public.invoices 
ADD COLUMN line_items JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.invoices.line_items IS 'Stores the line items (description, quantity, price, total) for each invoice';