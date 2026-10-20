# Thunder Supabase — where to work

Shared backend for every Thunder Pro app: dashboard, phone owner app, employee app, and client portal. Self-hosted Supabase. Schema is `supabase/migrations/`. HTTP behavior is `supabase/functions/`.

Change this repo when the task is data, RLS, an email, an SMS, a PDF the customer opens from a link, Stripe, or an employee clock call. A screen the owner taps inside an app is not changed here.

Every email and SMS is listed in `FEATURES.md` under Email and SMS. Read that section before changing a subject, a sentence, a link, or who receives the message.

The user deploys functions. Editing a function does nothing in production until that function is deployed.

## Hosts

| Environment | Functions base |
|---|---|
| Production | `https://portal.thunderpro.co` |
| Staging | `https://app.staging.thunderpro.co` |

Inside Docker, `SUPABASE_URL` is `http://kong:8000`. Links in email and SMS must use `resolvePublicSupabaseUrl()` or `resolvePublicFunctionsHost()` in `supabase/functions/_shared/`. Never put `kong` in a customer link.

Customer document pages are not on this host:

| Document | Public page | PDF the link should open |
|---|---|---|
| Estimate | `https://dashboard.thunderpro.co/public/estimate/:token` | `download-estimate-pdf` |
| Quick quote | `https://dashboard.thunderpro.co/public/quick-quote/:token` | `download-estimate-pdf` |
| Invoice pay | `https://dashboard.thunderpro.co/invoice/payment/:token` | Keep this for Pay. The view link is `download-invoice-pdf` |
| Marketing site | `https://thunderpro.co` | No app routes. A link here 404s |

`portal.thunderpro.co` is the owner app. It does not serve the new estimate sheet.

## What to change for a customer document

| Goal | Function | App still involved? |
|---|---|---|
| PDF opened from estimate or quote email/SMS | `download-estimate-pdf` | Dashboard and phone Download buttons use their own jsPDF copies |
| Estimate email button | `send-estimate-email` | Button href is `resolveDocumentPdfUrl` |
| Quick-quote email button | `send-quick-quote-email` | |
| Quick-quote SMS | `send-quick-quote-sms` | Ignores a URL sent by the app |
| Estimate SMS | `send-estimate-sms` | Pastes `estimateUrl` from the app. Change the app builder too |
| Invoice PDF from email | `download-invoice-pdf` | Email already points here. Response must stay `inline` so the browser shows it |
| Invoice SMS | `send-invoice-sms` | Rewrites the app URL to `resolveInvoicePdfUrl` |
| Invoice payment | `send-invoice-email` Pay button, `stripe-create-checkout`, `stripe-webhook`, `process-invoice-payment` | Do not replace Pay with the PDF |

PDF responses that should display in the browser use `Content-Disposition: inline`. `attachment` forces a download.

URL helpers and tests: `supabase/functions/_shared/resolveQuickQuoteViewUrl.ts` and `resolveQuickQuoteViewUrl.test.ts`. Run with `node --experimental-strip-types --test supabase/functions/_shared/resolveQuickQuoteViewUrl.test.ts`.

## Functions by feature

| Feature | Functions |
|---|---|
| Booking / request | `create-booking`, `send-booking-emails` |
| Estimates | `send-estimate-email`, `send-estimate-sms`, `accept-estimate`, `download-estimate-pdf` |
| Quick quotes | `send-quick-quote-email`, `send-quick-quote-sms`, `accept-quick-quote` (same PDF function as estimates) |
| Invoices | `send-invoice-email`, `send-invoice-sms`, `send-invoice-reminders`, `download-invoice-pdf`, `stripe-create-checkout`, `stripe-webhook`, `process-invoice-payment` |
| Stripe Connect | `stripe-onboard`, `stripe-check-account`, `stripe-dashboard-link`, `stripe-create-customer` |
| Jobs | `send-job-status-emails`, `send-job-status-sms`, `send-job-conversion-emails`, `send-job-reminders`, `notify-job-employees` |
| Appointments | `send-appointment-emails`, `send-appointment-sms`, `send-appointment-reminders`, `send-scheduled-appointment-emails` |
| Walkthroughs | `send-walkthrough-confirmation`, `send-walkthrough-update`, `send-walkthrough-cancellation`, `send-walkthrough-completion`, `send-walkthrough-status-emails`, matching `*-sms` functions, reminders |
| Contracts | `send-contract-email`, `send-contract-sms`, `download-contract-pdf`, `process-contract-expirations`, `accept-contract` |
| Employees / time clock | `validate-employee-phone`, `send-employee-otp`, `verify-employee-otp`, `employee-clock-action`, `get-scheduled-shifts`, `get-active-clock-session`, `upload-shift-photo`, `get-employee-time-history` |
| Client portal | `validate-client-portal-magic-link`, `client-wallet-get`, `client-wallet-setup-checkout`, `client-wallet-issue-token` |
| Auth mail | `send-verification-email`, `send-password-reset-email`, `send-signup-welcome` |
| Geo | `geocode-address` |
| View tracking | `mark-viewed` |
| Push | `register-device-token`, `register-user-device-token`, `send-push-notification`, `notify-user-push` |
| Billing plans | `revenuecat-webhook`, `update-subscription` |

Shared math lives in `supabase/functions/_shared/` (`invoiceCalculations.ts`, `invoiceAmountDue.ts`, `formatDateOnly.ts`, `geocodeAddress.ts`, `userCountry.ts`).

## Schema

Migrations are `supabase/migrations/`. Important tables the apps share: `profiles`, `clients`, `client_properties`, `leads`, `bookings`, `estimates`, `quick_quotes`, `jobs`, `invoices`, `walkthroughs`, `contracts`, `employees`, `time_entries`, `route_appointments`, `notifications`.

Country is filled by database triggers. Apps must not send a new country on update. `profiles.company_country` is frozen by `tr_lock_profile_company_country`.

`bookings` allows anonymous insert and blocks anonymous select. Public booking create goes through `create-booking`, which also sends the confirmation email. Do not add a second `send-booking-emails` call on that submit.

## Do not

- Point a customer link at `thunderpro.co` or `www.thunderpro.co` except the marketing footer `https://www.thunderpro.co`.
- Return a PDF as `attachment` when the task is to show it in the browser.
- Apply plan-gating SQL that blocks paying users from creating records. That was tried and rolled back.
- Assume a function edit is live. Tell the user which function names to deploy.
