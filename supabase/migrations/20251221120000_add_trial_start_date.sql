-- Add trial_start_date column to profiles to track when the trial actually started
-- This allows legacy users to have a 14-day trial starting from their first login in the new version
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS trial_start_date TIMESTAMP WITH TIME ZONE;

COMMENT ON COLUMN public.profiles.trial_start_date IS 'Date when the 14-day trial period started. Used for legacy user trial activation.';
