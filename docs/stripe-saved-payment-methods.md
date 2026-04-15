# Saved payment methods (Stripe Connect)

This document describes how **optional “save card for later”** on invoice Checkout and **merchant-initiated charges** work in this repo, and how to exercise them in **local development**.

## What it does

1. **Public invoice pay (Checkout)**  
   The client can opt in with **“Save this card for future payments”**. When enabled, the app calls `stripe-create-checkout` with `savePaymentMethod: true`.

2. **Stripe**  
   Checkout creates a **Customer** on the merchant’s **connected account** (when only an email is known, `customer_creation: 'always'` is used). The **PaymentIntent** uses `setup_future_usage: 'off_session'` so the card can be charged again without the client being present.

3. **After payment (`stripe-webhook`)**  
   On `checkout.session.completed`, the existing flow still marks the invoice **Paid** and records the payment. **Additionally**, if metadata includes `save_payment_method: 'true'`, a **non-blocking** block tries to update **one** row in `public.clients` where:
   - `user_id` = invoice merchant (`invoices.user_id`), and  
   - `email` exactly matches the invoice payer email (`invoices.email`, trimmed).

   Columns written (see migration `20260413120000_add_clients_stripe_payment_columns.sql`):

   - `stripe_customer_id`
   - `stripe_default_payment_method_id`
   - `card_brand`, `card_last4`, `card_exp_month`, `card_exp_year`

   If there is **no** matching `clients` row, nothing is stored in Postgres (the Customer still exists in Stripe on the connected account).

4. **Client wallet (public link + Setup Checkout)**  
   Merchants issue an opaque token (`client-wallet-issue-token` → row in `client_wallet_tokens`). The client opens **`/client/wallet/:token`** on the dashboard (no login). They can run **`client-wallet-setup-checkout`**, which creates Stripe Checkout **`mode: setup`** on the merchant’s connected account. On `checkout.session.completed` with `metadata.client_wallet_setup`, **`stripe-webhook`** updates the same **`clients`** vault columns as invoice save-card.

5. **Charge later (`stripe-charge-saved-invoice`)**  
   An authenticated **merchant** calls this function with `{ "invoiceId": "<uuid>" }`. It:
   - Ensures the invoice is **Pending**, belongs to the caller, and amount is valid.
   - Loads the same `clients` row by `user_id` + invoice `email` and requires `stripe_customer_id` + `stripe_default_payment_method_id`.
   - Creates a **PaymentIntent** on the **connected account** (`off_session: true`, `confirm: true`), with `application_fee_amount: 0` (same default as Checkout in this codebase).
   - On success: updates invoice to **Paid**, inserts `payments`, triggers payment confirmation email, notification, and activity (aligned with the webhook’s paid path).

## Edge functions involved

| Function | Role |
|----------|------|
| `stripe-create-checkout` | Optional `savePaymentMethod`; sets Checkout session + PI for save-on-pay when true. |
| `stripe-webhook` | `checkout.session.completed` → paid invoice + optional client vault update. |
| `stripe-charge-saved-invoice` | Merchant JWT → charge pending invoice with saved PM. |
| `client-wallet-issue-token` | Merchant JWT → insert `client_wallet_tokens`, return public wallet URL. |
| `client-wallet-get` | Public POST `{ token }` → company + client + masked card list. |
| `client-wallet-setup-checkout` | Public POST `{ token }` → Checkout **setup** session URL. |

`stripe-charge-saved-invoice` is configured with **`verify_jwt = true`** in `supabase/config.toml`. `stripe-webhook` uses **`verify_jwt = false`** and relies on the **Stripe signing secret**.

## Environment variables

Typical secrets (local or hosted):

- `STRIPE_SECRET_KEY` — platform secret; used with `stripeAccount` for Connect calls.
- `STRIPE_WEBHOOK_SECRET` — from `stripe listen` or the Dashboard webhook endpoint (must match how you verify events).
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — set automatically when running under Supabase; for `supabase functions serve`, configure in `supabase/functions/.env` or CLI flags as per Supabase docs.
- `APP_URL` — success/cancel URLs for Checkout (defaults exist in code).

## How to test in development

### 1. Apply the database migration

Ensure the `clients` Stripe columns exist:

```bash
cd /path/to/thunder_supabase
supabase db reset   # local only; wipes data — or run pending migrations on your branch
# or: supabase migration up
```

### 2. Run Supabase locally (optional but recommended)

```bash
supabase start
```

Note the local **API URL** and **anon key** for the app; use **Stripe test mode** keys in function secrets.

### 3. Serve edge functions locally

```bash
supabase functions serve --env-file supabase/functions/.env
```

(Use a `.env` that contains at least `STRIPE_SECRET_KEY`, and the same Supabase vars the CLI injects, if not auto-injected.)

Point your frontend (`thunder_dashboard` / `swift-slate`) at the **local** Supabase URL if you are testing against local functions (see each app’s `.env` / `VITE_*` / Supabase client config).

### 4. Forward Stripe webhooks to local `stripe-webhook`

Checkout completion is driven by **`checkout.session.completed`**. For Connect, ensure your Stripe CLI listener forwards **Connect** events if your webhook is registered that way:

```bash
stripe listen --forward-to http://127.0.0.1:54321/functions/v1/stripe-webhook
```

Copy the **webhook signing secret** into `STRIPE_WEBHOOK_SECRET` for the served function.

### 5. Stripe Connect test merchant

- Complete **Stripe Connect onboarding** for a test user (Express or your configured type) so `profiles.stripe_account_id` and onboarding flags allow charges.
- Use **test** cards only (e.g. `4242 4242 4242 4242`).

### 6. Data you must create to test the full loop

1. **Merchant user** with Stripe Connect on file (`profiles`).
2. **`clients` row** for that merchant where **`email` matches** the invoice payer email exactly (same string you will put on the invoice). Without this, pay-with-save still works in Stripe, but the **vault columns stay empty** in Postgres.
3. **Invoice** in **Pending** status with that `email`, `user_id` = merchant, and a positive `total`.

### 7. Test scenarios

**A — Regression (save off)**  
Pay from the public link **without** checking “Save this card…”. Behavior should match the old path: Checkout → webhook → invoice **Paid**, no requirement for a `clients` row.

**B — Save on pay**  
Check “Save this card…”, complete Checkout. After webhook:

- Invoice **Paid**, `payments` row present.
- Matching `clients` row has `stripe_customer_id`, `stripe_default_payment_method_id`, and card display fields.

**C — Charge saved card**  
Create a **new** **Pending** invoice with the **same payer email**. From the dashboard (invoice side panel), use **“Charge card on file”** (only shown when Stripe is ready and saved PM exists). Expect:

- PaymentIntent **succeeded** in Stripe (connected account).
- Invoice **Paid**, new `payments` row, confirmation email path invoked.

**D — Off-session / SCA**  
Some test cards force **authentication required** on off-session charges. If the charge fails with a message about the payment not completing, try another test card or use Stripe’s docs for **off-session** testing.

## Troubleshooting

| Symptom | Likely cause |
|---------|----------------|
| Vault columns never fill | No `clients` row with same `email` as `invoices.email`, or checkbox / `savePaymentMethod` not sent. |
| Webhook never runs locally | `stripe listen` not forwarding, wrong URL/port, or wrong `STRIPE_WEBHOOK_SECRET`. |
| `stripe-charge-saved-invoice` 401 | Missing or invalid Supabase JWT (`verify_jwt = true`). |
| Checkout error when save is on | Stripe rejects session (e.g. missing email, Connect misconfiguration); check function logs. |

## Related files

- Migration: `supabase/migrations/20260413120000_add_clients_stripe_payment_columns.sql`
- Migration: `supabase/migrations/20260415180000_client_wallet_tokens.sql`
- Checkout: `supabase/functions/stripe-create-checkout/index.ts`
- Webhook: `supabase/functions/stripe-webhook/index.ts`
- Charge: `supabase/functions/stripe-charge-saved-invoice/index.ts`
- Config: `supabase/config.toml` (`stripe-webhook`, `stripe-charge-saved-invoice`)
