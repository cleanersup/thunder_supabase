-- Add discount and tax columns to invoices table
ALTER TABLE public.invoices 
ADD COLUMN discount_type TEXT,
ADD COLUMN discount_value NUMERIC,
ADD COLUMN tax_rate NUMERIC;

COMMENT ON COLUMN public.invoices.discount_type IS 'Type of discount: percentage or fixed';
COMMENT ON COLUMN public.invoices.discount_value IS 'Discount value (percentage or fixed amount)';
COMMENT ON COLUMN public.invoices.tax_rate IS 'Tax rate percentage';