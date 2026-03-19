-- Add subscription and Square payment fields to profiles table
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS is_subscribed BOOLEAN,
ADD COLUMN IF NOT EXISTS square_customer_id TEXT,
ADD COLUMN IF NOT EXISTS square_subscription_id TEXT,
ADD COLUMN IF NOT EXISTS has_payment_failed BOOLEAN,
ADD COLUMN IF NOT EXISTS subscription_free BOOLEAN,
ADD COLUMN IF NOT EXISTS used_subscription BOOLEAN;

-- Add personal address fields (separate from company address)
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS address TEXT,
ADD COLUMN IF NOT EXISTS address_unit TEXT,
ADD COLUMN IF NOT EXISTS city TEXT,
ADD COLUMN IF NOT EXISTS zip TEXT;

-- Add complex data fields (JSONB)
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS stripe_account_info JSONB,
ADD COLUMN IF NOT EXISTS push_notification_tokens JSONB,
ADD COLUMN IF NOT EXISTS roles JSONB;

-- Add contract file reference
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS file_id_contract_residential TEXT;

-- Add comments for documentation
COMMENT ON COLUMN public.profiles.is_subscribed IS 'Whether the user has an active subscription';
COMMENT ON COLUMN public.profiles.square_customer_id IS 'Square payment customer ID';
COMMENT ON COLUMN public.profiles.square_subscription_id IS 'Square subscription ID';
COMMENT ON COLUMN public.profiles.has_payment_failed IS 'Whether the last payment attempt failed';
COMMENT ON COLUMN public.profiles.subscription_free IS 'Whether the subscription is free tier';
COMMENT ON COLUMN public.profiles.used_subscription IS 'Whether the user has used a subscription';
COMMENT ON COLUMN public.profiles.address IS 'User personal address (not company address)';
COMMENT ON COLUMN public.profiles.address_unit IS 'User personal address unit/apt (not company)';
COMMENT ON COLUMN public.profiles.city IS 'User personal city (not company city)';
COMMENT ON COLUMN public.profiles.zip IS 'User personal zip code (not company zip)';
COMMENT ON COLUMN public.profiles.stripe_account_info IS 'Stripe account information stored as JSONB';
COMMENT ON COLUMN public.profiles.push_notification_tokens IS 'Push notification tokens array stored as JSONB';
COMMENT ON COLUMN public.profiles.roles IS 'User roles array stored as JSONB';
COMMENT ON COLUMN public.profiles.file_id_contract_residential IS 'File ID reference for residential contract';

