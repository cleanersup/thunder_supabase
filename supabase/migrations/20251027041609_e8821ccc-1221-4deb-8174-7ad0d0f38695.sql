-- Add attachments column to invoices table
ALTER TABLE public.invoices 
ADD COLUMN attachments jsonb DEFAULT '[]'::jsonb;