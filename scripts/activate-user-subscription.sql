-- Activate subscription for one user (run in psql against postgres DB).
-- Replace the email below before executing the UPDATE.

-- 1) Preview (before)
SELECT
    u.id AS user_id,
    u.email,
    u.created_at AS user_created_at,
    p.plan_tier,
    p.subscription_status,
    p.subscription_expiry_date,
    p.created_at AS profile_created_at,
    p.company_name,
    p.first_name,
    p.last_name,
    p.trial_end_date,
    p.is_subscribed,
    p.revenue_cat_customer_id
FROM auth.users u
LEFT JOIN public.profiles p ON u.id = p.user_id
WHERE u.email = 'alicianl22@gmail.com';

-- 2) Set subscription_status to active
UPDATE public.profiles p
SET
    subscription_status = 'active',
    updated_at = now()
FROM auth.users u
WHERE p.user_id = u.id
  AND u.email = 'alicianl22@gmail.com';

-- Optional: grant a paid tier (uncomment if the app should treat them as subscribed, not only trial)
-- UPDATE public.profiles p
-- SET
--     plan_tier = 'professional',
--     subscription_status = 'active',
--     is_subscribed = true,
--     subscription_expiry_date = now() + interval '1 year',
--     updated_at = now()
-- FROM auth.users u
-- WHERE p.user_id = u.id
--   AND u.email = 'alicianl22@gmail.com';

-- 3) Verify (after)
SELECT
    u.id AS user_id,
    u.email,
    p.plan_tier,
    p.subscription_status,
    p.subscription_expiry_date,
    p.trial_end_date,
    p.is_subscribed,
    p.revenue_cat_customer_id,
    p.updated_at
FROM auth.users u
LEFT JOIN public.profiles p ON u.id = p.user_id
WHERE u.email = 'alicianl22@gmail.com';
