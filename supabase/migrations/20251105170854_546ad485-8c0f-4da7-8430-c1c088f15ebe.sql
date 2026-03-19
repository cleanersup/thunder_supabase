-- Add viewed_at column to estimates table
ALTER TABLE public.estimates 
ADD COLUMN IF NOT EXISTS viewed_at timestamp with time zone;

-- Add viewed_at column to invoices table
ALTER TABLE public.invoices 
ADD COLUMN IF NOT EXISTS viewed_at timestamp with time zone;

-- Create index for better performance
CREATE INDEX IF NOT EXISTS idx_estimates_viewed_at ON public.estimates(viewed_at);
CREATE INDEX IF NOT EXISTS idx_invoices_viewed_at ON public.invoices(viewed_at);