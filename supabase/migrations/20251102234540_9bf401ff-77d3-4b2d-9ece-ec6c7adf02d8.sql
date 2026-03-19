-- Add avatar_url column to employees table
ALTER TABLE public.employees 
ADD COLUMN IF NOT EXISTS avatar_url TEXT;