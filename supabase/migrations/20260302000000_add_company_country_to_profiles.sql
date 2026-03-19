-- Add company_country field to profiles table for registration country selection
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS company_country TEXT;
