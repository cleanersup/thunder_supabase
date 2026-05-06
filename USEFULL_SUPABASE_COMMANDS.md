#DEPLOY SUPABASE NEW PROJECT FOLDER
scp -r /Users/carloszavala/Desktop/programacion/thunderpro/thunder_supabase/supabase staging.thunderpro.co:/home/admin/thunder_supabase

#DEPLOY CLIENT DASHBOARD STAGING
scp -r dist/* staging.thunderpro.co:/var/www/client_payments_dashboard/dist

#DEPLOY CLIENT DASHBOARD PRODUCTION
scp -r dist/* staging.thunderpro.co:/var/www/client_payments_dashboard/dist

#DEPLOY SWIFT SLATE FOR MOBILE
scp -r dist/* staging.thunderpro.co:/home/admin/swift-slate/dist

#DEPLOY THUNDER DASHBOARD
scp -r dist/* staging.thunderpro.co:/var/www/thunder_dashboard/

#DEPLOY THUNDER DASHBOARD PROD
scp -r dist/* thunderpro.co:/var/www/thunder_dashboard/

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

#Users with RevenueCat customer id — email, name, company_name, phone (missing/blank → NA). Phone = profiles.phone_number; use p.company_phone instead if you want the business line.
SELECT
  COALESCE(NULLIF(trim(COALESCE(u.email::text, '')), ''), 'NA') AS email,
  COALESCE(NULLIF(trim(concat_ws(' ', p.first_name, p.last_name)), ''), 'NA') AS name,
  COALESCE(NULLIF(trim(COALESCE(p.company_name::text, '')), ''), 'NA') AS company_name,
  COALESCE(NULLIF(trim(COALESCE(p.phone_number::text, '')), ''), 'NA') AS phone_number
FROM auth.users u
INNER JOIN profiles p ON u.id = p.user_id
WHERE p.revenue_cat_customer_id IS NOT NULL
  AND btrim(p.revenue_cat_customer_id) <> ''
ORDER BY u.email;

#Export to CSV (Supabase blocks server `COPY ... TO '/path'` — use \copy or COPY TO STDOUT)
#
#In psql (postgres=>): \copy writes from the client — one line:
#\copy (SELECT COALESCE(NULLIF(trim(COALESCE(u.email::text, '')), ''), 'NA') AS email, COALESCE(NULLIF(trim(concat_ws(' ', p.first_name, p.last_name)), ''), 'NA') AS name, COALESCE(NULLIF(trim(COALESCE(p.company_name::text, '')), ''), 'NA') AS company_name, COALESCE(NULLIF(trim(COALESCE(p.phone_number::text, '')), ''), 'NA') AS phone_number FROM auth.users u INNER JOIN profiles p ON u.id = p.user_id WHERE p.revenue_cat_customer_id IS NOT NULL AND btrim(p.revenue_cat_customer_id) <> '' ORDER BY u.email) TO '/tmp/revenuecat_emails.csv' WITH CSV HEADER
#
#From SSH on the host: file at /tmp inside the DB container, then docker cp to host:
docker exec -i supabase_db_euydrdzayvjahstvmwoj psql -U postgres -d postgres <<'EOF'
\copy (
SELECT
  COALESCE(NULLIF(trim(COALESCE(u.email::text, '')), ''), 'NA') AS email,
  COALESCE(NULLIF(trim(concat_ws(' ', p.first_name, p.last_name)), ''), 'NA') AS name,
  COALESCE(NULLIF(trim(COALESCE(p.company_name::text, '')), ''), 'NA') AS company_name,
  COALESCE(NULLIF(trim(COALESCE(p.phone_number::text, '')), ''), 'NA') AS phone_number
FROM auth.users u
INNER JOIN profiles p ON u.id = p.user_id
WHERE p.revenue_cat_customer_id IS NOT NULL
  AND btrim(p.revenue_cat_customer_id) <> ''
ORDER BY u.email
) TO '/tmp/revenuecat_emails.csv' WITH CSV HEADER
EOF

docker cp supabase_db_euydrdzayvjahstvmwoj:/tmp/revenuecat_emails.csv ~/revenuecat_emails.csv

#From your Mac (replace YOUR_SERVER_HOST):
#scp admin@YOUR_SERVER_HOST:~/revenuecat_emails.csv /Users/carloszavala/Desktop/revenuecat_emails.csv

#Stream CSV to Desktop in one shot (COPY TO STDOUT):
#ssh admin@YOUR_SERVER_HOST "docker exec supabase_db_euydrdzayvjahstvmwoj psql -U postgres -d postgres -c \"COPY ( SELECT COALESCE(NULLIF(trim(COALESCE(u.email::text, '')), ''), 'NA') AS email, COALESCE(NULLIF(trim(concat_ws(' ', p.first_name, p.last_name)), ''), 'NA') AS name, COALESCE(NULLIF(trim(COALESCE(p.company_name::text, '')), ''), 'NA') AS company_name, COALESCE(NULLIF(trim(COALESCE(p.phone_number::text, '')), ''), 'NA') AS phone_number FROM auth.users u INNER JOIN profiles p ON u.id = p.user_id WHERE p.revenue_cat_customer_id IS NOT NULL AND btrim(p.revenue_cat_customer_id) <> '' ORDER BY u.email ) TO STDOUT WITH CSV HEADER\"" > /Users/carloszavala/Desktop/revenuecat_emails.csv


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

#DELETE USER (irreversible — run SELECT first to confirm the row)
#Each line below must be run as a full SQL statement (starts with SELECT or DELETE). Do not paste only the WHERE clause.
#Deletes public profile row, then removes the auth account (login + auth.* cascades on hosted Supabase).
#If DELETE FROM auth.users fails with a FK error, remove or fix the referencing row in the table named in the error, then retry.

#Preview user before delete
SELECT u.id, u.email, u.created_at
FROM auth.users u
WHERE u.email = 'info@cleanersup.com';

DELETE FROM public.profiles p
USING auth.users u
WHERE p.user_id = u.id AND u.email = 'info@cleanersup.com';

DELETE FROM auth.users
WHERE email = 'info@cleanersup.com';

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

# --- Stripe webhooks: invoice Paid + Saved client cards (Connect) ---
# Code/migrations are not enough — Stripe must POST checkout.session.completed to stripe-webhook.
#
# If Workbench → Webhooks shows “Total: 0” / no event deliveries after a real Checkout pay:
#   Add (or use) the CLASSIC Connect webhook — Stripe’s Connect doc points here, not only Workbench:
#   https://dashboard.stripe.com/test/webhooks   (toggle Test mode ON)
#   Add endpoint → same HTTPS URL → “Listen to” = **Events on connected accounts**
#   → select event **checkout.session.completed** → save → copy THAT endpoint’s whsec_…
#   Workbench “destinations” sometimes show zero deliveries while classic webhooks work.
#
# 1) Endpoint URL examples:
#    https://PROJECT_REF.supabase.co/functions/v1/stripe-webhook
#    OR custom domain: https://staging.thunderpro.co/functions/v1/stripe-webhook
#
# 2) Stripe Dashboard (same mode as your keys: Test vs Live)
#    Prefer: Developers → Webhooks (link above) for Connect + checkout.session.completed
#    Events: at least checkout.session.completed
#    For Connect (Checkout on connected accounts): “Listen to” MUST be **Events on connected accounts**
#    (see https://docs.stripe.com/connect/webhooks )
#    After saving, open the endpoint → Signing secret → copy whsec_...
#
# 3) Supabase Dashboard → Project Settings → Edge Functions → Secrets
#    STRIPE_WEBHOOK_SECRET = whsec_... (must match the endpoint from step 2)
#    STRIPE_SECRET_KEY = same Stripe mode (sk_test_... or sk_live_...)
#    Redeploy stripe-webhook if secrets were wrong before (supabase functions deploy stripe-webhook).
#
# 4) Verify after one test payment
#    Stripe → Webhooks → endpoint → Recent deliveries → checkout.session.completed → HTTP 200
#    Supabase → Edge Functions → stripe-webhook → Logs → "Webhook verified", "[Vault]" lines
#    SQL: SELECT stripe_default_payment_method_id FROM public.clients WHERE ...;
#
# 5) Local dev: Stripe cannot reach localhost without CLI:
#    stripe listen --forward-to http://127.0.0.1:54321/functions/v1/stripe-webhook
#    Put CLI whsec into supabase/functions/.env STRIPE_WEBHOOK_SECRET, restart supabase functions serve.

# --- Stripe webhook: zero deliveries / no Docker logs (self-hosted staging.thunderpro.co) ---
#
# A) Prove traffic reaches the edge function (bypasses Stripe):
#    curl -sS "https://staging.thunderpro.co/functions/v1/stripe-webhook"
#    Expect JSON: {"ok":true,"fn":"stripe-webhook"}  AND docker logs show: [stripe-webhook] GET health check
#    If curl fails or no log line → Kong/nginx/DNS in front of Supabase, not Stripe.
#
# B) Prove POST reaches the function (signature will fail — OK for this test):
#    curl -sS -i -X POST "https://staging.thunderpro.co/functions/v1/stripe-webhook" \
#      -H "Content-Type: application/json" -d '{}'
#    Expect HTTP 400 and Docker logs: [stripe-webhook] ← POST … then signature FAILED or Missing stripe-signature
#    If HTTP 401 before any [stripe-webhook] line → Kong JWT: ensure config.toml has
#       [functions.stripe-webhook] verify_jwt = false
#    then redeploy/reload edge functions so the gateway applies it (see GitHub supabase discussions re 401 + verify_jwt).
#
# C) Stripe Dashboard: Workbench can show "Total: 0" deliveries. Also add CLASSIC endpoint:
#    https://dashboard.stripe.com/test/webhooks → Add endpoint → same URL
#    → Listen to: Events on connected accounts → event checkout.session.completed
#    → copy THAT signing secret into STRIPE_WEBHOOK_SECRET (Workbench vs classic = different whsec).
#
# D) On the destination, click "Show" next to "Listening to: 1 event" — must be exactly checkout.session.completed.
#
# E) whsec_ must be copied again after you "Roll" the secret in Stripe; update Supabase secrets and restart edge if needed.