-- Lock the subscription columns of public.profiles against client writes.
--
-- Without this, any signed-in user can UPDATE their own profiles row and set
-- plan_tier = 'professional', which defeats has_plan_feature() and every
-- plan_gate_insert policy.
--
-- ⚠️ Run this ONLY after confirming the RevenueCat webhook updates profiles in
-- this environment (RevenueCat → Integrations → Webhooks shows 200 responses,
-- and a purchase changes plan_tier without the app open). Today the mobile app
-- also writes plan_tier itself after a purchase (revenueCatService.syncWithSupabase);
-- once this runs, that write is silently discarded and the webhook becomes the
-- only thing that unlocks a purchase. If the webhook is not delivering, paying
-- users stay on their old plan.
--
-- Kept out of supabase/migrations on purpose so `supabase db push` cannot apply
-- it before that check. Run it manually in the SQL editor of each environment.
--
-- Who can still write these columns: service_role (revenuecat-webhook, other
-- edge functions), and postgres (SQL editor, cron, SECURITY DEFINER functions
-- called without a user session). Requests carrying a user JWT cannot — even
-- through a SECURITY DEFINER function, because the check reads the JWT role,
-- not current_user.
--
-- trial_start_date stays writable once, from NULL, and never into the future:
-- the app persists it on first load, but it must not be movable to restart the
-- trial.

CREATE OR REPLACE FUNCTION public.lock_profile_subscription_columns ()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_role text := COALESCE(
    NULLIF(current_setting('request.jwt.claim.role', true), ''),
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
  );
BEGIN
  IF v_role IS DISTINCT FROM 'authenticated' THEN
    RETURN NEW;
  END IF;

  NEW.plan_tier                := OLD.plan_tier;
  NEW.subscription_status      := OLD.subscription_status;
  NEW.subscription_expiry_date := OLD.subscription_expiry_date;
  NEW.revenue_cat_customer_id  := OLD.revenue_cat_customer_id;
  NEW.used_subscription        := OLD.used_subscription;
  NEW.trial_end_date           := OLD.trial_end_date;

  IF OLD.trial_start_date IS NOT NULL THEN
    NEW.trial_start_date := OLD.trial_start_date;
  ELSIF NEW.trial_start_date IS NOT NULL AND NEW.trial_start_date > now() THEN
    NEW.trial_start_date := now();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_lock_profile_subscription_columns ON public.profiles;
CREATE TRIGGER tr_lock_profile_subscription_columns
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.lock_profile_subscription_columns ();

-- Rollback:
--   DROP TRIGGER IF EXISTS tr_lock_profile_subscription_columns ON public.profiles;
--   DROP FUNCTION IF EXISTS public.lock_profile_subscription_columns ();
