#CONNECT TO DB
docker exec -it supabase_db_euydrdzayvjahstvmwoj psql -U postgres -d postgres

#DEACTIVATE PAGER ON PSQL
\pset pager off

#MAKE MIGRATION
docker exec -i supabase_db_euydrdzayvjahstvmwoj psql -U postgres -d postgres < supabase/migrations/20251221120000_add_trial_start_date.sql

#START SUPABASE WORKING NOW STAGING AND PROD DEFAULT SAVE GUARD   
supabase start -x postgres-meta,studio,logflare,imgproxy,storage-api

#START SUPABASE WORKING NOW PROD
supabase start -x postgres-meta,studio,logflare,imgproxy

#START SUPABASE WORKING NOW WITH STORAGE
supabase start -x postgres-meta,studio,logflare,imgproxy > supabase_start.log 2>&1 &

#DEPLOY BUILD TO STAGING OF CODE
scp -r dist/* admin@thunderpro.staging.thunderpro.co:/home/admin/swift-slate/dist

#DEPLOY BUILD TO PROD OF CODE
scp -r dist/* admin@thunderpro.thunderpro.co:/home/admin/swift-slate/dist

#SEE SUPABASE LOGS
docker logs supabase_edge_runtime_euydrdzayvjahstvmwoj --follow

#Check user profile data
SELECT 
    u.id as user_id,
    u.email,
    u.created_at as user_created_at,
    p.plan_tier,
    p.subscription_status,
    p.created_at as profile_created_at,
    p.company_name,
    p.first_name,
    p.last_name,
    p.trial_end_date,
    p.is_subscribed,
    p.revenue_cat_customer_id
FROM auth.users u
LEFT JOIN profiles p ON u.id = p.user_id
WHERE u.email LIKE '%thunderproinc@gmail.com%';


#UPDATE USER PASSWORD
UPDATE auth.users
SET 
  encrypted_password = 'YOUR_BCRYPT_HASH_HERE',
  updated_at = now()
WHERE email = 'thunderproinc@gmail.com';

#CHECK USER SUSCRIPTION
SELECT 
    u.id as user_id,
    u.email,
    plan_tier, 
    subscription_status, 
    subscription_expiry_date, 
    revenue_cat_customer_id, 
    p.created_at as profile_created_at,
    p.company_name,
    p.first_name,
    p.last_name,
    p.trial_end_date
FROM auth.users u
LEFT JOIN profiles p ON u.id = p.user_id
WHERE u.email LIKE '%info@vipcleaningsvcs.com%';

#CHECK IF USER HAS STRIPE ACCOUNT:

SELECT stripe_account_id, stripe_onboarding_completed, stripe_charges_enabled, stripe_payouts_enabled FROM profiles WHERE user_id = 'fee24cde-9909-450a-9431-c238fbb5e156';

#Check profile data 2 
SELECT 
    u.id as user_id,
    u.email,
    u.created_at as user_created_at,
    p.plan_tier,
    p.subscription_status,
    p.created_at as profile_created_at,
    p.company_name,
    p.first_name,
    p.last_name,
    p.trial_end_date,
    p.is_subscribed,
    p.subscription_status,
    p.subscription_expiry_date,
    p.trial_start_date,
    p.trial_end_date,
    p.stripe_onboarding_completed,
    p.stripe_charges_enabled,
    p.stripe_payouts_enabled

FROM auth.users u
LEFT JOIN profiles p ON u.id = p.user_id
WHERE u.email LIKE '%info@vipcleaningsvcs.com%';

#Check user with last estimate/invoice and counts
SELECT 
    u.id as user_id,
    u.email,
    u.created_at as user_created_at,
    p.plan_tier,
    p.subscription_status,
    p.created_at as profile_created_at,
    p.company_name,
    p.first_name,
    p.last_name,
    p.trial_end_date,
    p.is_subscribed,
    (SELECT MAX(created_at) FROM estimates WHERE user_id = u.id) as last_estimate_created_at,
    (SELECT COUNT(*) FROM estimates WHERE user_id = u.id) as estimate_count,
    (SELECT MAX(created_at) FROM invoices WHERE user_id = u.id) as last_invoice_created_at,
    (SELECT COUNT(*) FROM invoices WHERE user_id = u.id) as invoice_count
FROM auth.users u
LEFT JOIN profiles p ON u.id = p.user_id
WHERE u.email LIKE '%info@vipcleaningsvcs.com%';

#Check user Stripe account by stripe Id:
SELECT 
    u.id as user_id,
    u.email,
    u.created_at as user_created_at,
    p.stripe_account_id,
    p.company_name,
    p.first_name,
    p.last_name,
    p.created_at as profile_created_at
FROM auth.users u
LEFT JOIN profiles p ON u.id = p.user_id
WHERE p.stripe_account_id = 'acct_xxxxxxxxxxxxx';

#Update user profile stripe acocunt to active
UPDATE profiles
SET 
    stripe_onboarding_completed = TRUE,
    stripe_charges_enabled = TRUE,
    stripe_payouts_enabled = TRUE
WHERE user_id = (
    SELECT id 
    FROM auth.users 
    WHERE email = 'info.cleaningij@gmail.com'
);

#UPDATE USER SUSCRIPTION
UPDATE profiles
SET subscription_status = 'active'
WHERE user_id = (
    SELECT id 
    FROM auth.users 
    WHERE email = 'info@cleanersup.com'
);

#FIND USER WITH BY REVENUECAT ID:
SELECT 
    u.id as user_id,
    u.email,
    p.plan_tier, 
    p.subscription_status, 
    p.subscription_expiry_date, 
    p.revenue_cat_customer_id, 
    p.created_at as profile_created_at,
    p.company_name,
    p.first_name,
    p.last_name,
    p.trial_end_date
FROM auth.users u
LEFT JOIN profiles p ON u.id = p.user_id
WHERE p.revenue_cat_customer_id = 'YOUR_REVENUECAT_ID_HERE';

#Run app on emulators
npm run build 
npx cap sync ios
npx cap open ios
npx cap run ios

#Phone
iPhone 17 Pro Max (simulator) (00360C5F-8C56-4CC9-836E-4E73D52BDA64)