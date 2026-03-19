-- Update plan_tier check constraint to include new plans
-- We need to drop the old constraint and add a new one that includes 'essential' and 'professional'

ALTER TABLE public.profiles 
DROP CONSTRAINT IF EXISTS profiles_plan_tier_check;

ALTER TABLE public.profiles 
ADD CONSTRAINT profiles_plan_tier_check 
CHECK (plan_tier IN ('free', 'basic', 'premium', 'essential', 'professional'));

-- Update comment to reflect new values
COMMENT ON COLUMN public.profiles.plan_tier IS 'Subscription plan tier: free, basic, essential, professional, or premium (legacy)';
