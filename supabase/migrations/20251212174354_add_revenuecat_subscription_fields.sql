-- Add RevenueCat subscription fields to profiles table
-- This migration adds columns to store detailed subscription information from RevenueCat

ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS plan_tier TEXT DEFAULT 'free' CHECK (plan_tier IN ('free', 'basic', 'premium')),
ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT 'inactive' CHECK (subscription_status IN ('active', 'cancelled', 'inactive')),
ADD COLUMN IF NOT EXISTS subscription_expiry_date TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS revenue_cat_customer_id TEXT;

-- Add comments for documentation
COMMENT ON COLUMN public.profiles.plan_tier IS 'Subscription plan tier: free, basic (monthly), or premium (yearly)';
COMMENT ON COLUMN public.profiles.subscription_status IS 'Current subscription status: active (will renew), cancelled (active until expiry), or inactive';
COMMENT ON COLUMN public.profiles.subscription_expiry_date IS 'Date when the current subscription expires (UTC)';
COMMENT ON COLUMN public.profiles.revenue_cat_customer_id IS 'RevenueCat customer ID for this user';

-- Create index on revenue_cat_customer_id for faster lookups
CREATE INDEX IF NOT EXISTS idx_profiles_revenue_cat_customer_id ON public.profiles(revenue_cat_customer_id);

-- Create index on plan_tier for analytics queries
CREATE INDEX IF NOT EXISTS idx_profiles_plan_tier ON public.profiles(plan_tier);
