-- Add trial_welcome_shown column to profiles table
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS trial_welcome_shown BOOLEAN DEFAULT FALSE;
