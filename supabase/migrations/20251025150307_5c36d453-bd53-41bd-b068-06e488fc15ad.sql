-- Add walkthrough scheduling fields to leads table
ALTER TABLE public.leads 
ADD COLUMN walkthrough_date DATE,
ADD COLUMN walkthrough_time TIME;