-- Add trial subscription fields to profiles table
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS plan_tier TEXT DEFAULT 'free',
ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT 'inactive',
ADD COLUMN IF NOT EXISTS subscription_expiry_date TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS revenue_cat_customer_id TEXT,
ADD COLUMN IF NOT EXISTS trial_start_date TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS trial_end_date TIMESTAMP WITH TIME ZONE;

-- Add comments for documentation
COMMENT ON COLUMN public.profiles.plan_tier IS 'Subscription plan tier: free, basic, essential, professional';
COMMENT ON COLUMN public.profiles.subscription_status IS 'Subscription status: active, inactive, cancelled, expired';
COMMENT ON COLUMN public.profiles.subscription_expiry_date IS 'Date when the subscription expires';
COMMENT ON COLUMN public.profiles.revenue_cat_customer_id IS 'RevenueCat customer ID for subscription management';
COMMENT ON COLUMN public.profiles.trial_start_date IS 'Date when the trial period started';
COMMENT ON COLUMN public.profiles.trial_end_date IS 'Date when the trial period ends';

-- Create function to initialize trial subscription for new users
CREATE OR REPLACE FUNCTION public.initialize_trial_subscription()
RETURNS TRIGGER AS $$
BEGIN
  -- Set 14-day trial with Professional plan access
  NEW.plan_tier = 'professional';
  NEW.subscription_status = 'active';
  NEW.trial_start_date = now();
  NEW.trial_end_date = now() + interval '14 days';
  NEW.subscription_expiry_date = now() + interval '14 days';
  NEW.used_subscription = true;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Create trigger to automatically initialize trial for new profiles
CREATE TRIGGER trigger_initialize_trial_subscription
BEFORE INSERT ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.initialize_trial_subscription();
