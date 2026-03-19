-- Add hourly_pay and address columns to employees table
ALTER TABLE public.employees 
ADD COLUMN IF NOT EXISTS hourly_pay numeric,
ADD COLUMN IF NOT EXISTS address text;