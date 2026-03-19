-- Migration: Add Stripe Connect fields to profiles table
-- Purpose: Store Stripe Connect account information for merchant onboarding

-- Add stripe_account_id column to profiles table
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS stripe_account_id TEXT,
ADD COLUMN IF NOT EXISTS stripe_onboarding_completed BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS stripe_charges_enabled BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS stripe_payouts_enabled BOOLEAN DEFAULT FALSE;

-- Add index for faster lookups by stripe_account_id
CREATE INDEX IF NOT EXISTS idx_profiles_stripe_account_id ON profiles(stripe_account_id);

-- Add comments for documentation
COMMENT ON COLUMN profiles.stripe_account_id IS 'Stripe Connect account ID (acct_xxx)';
COMMENT ON COLUMN profiles.stripe_onboarding_completed IS 'Whether the merchant completed Stripe onboarding';
COMMENT ON COLUMN profiles.stripe_charges_enabled IS 'Whether the Stripe account can accept charges';
COMMENT ON COLUMN profiles.stripe_payouts_enabled IS 'Whether the Stripe account can receive payouts';
