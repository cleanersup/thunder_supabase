# Thunder Supabase — features

The shared server for every Thunder Pro app. It holds the database, the access rules, and the functions that send email, text messages, PDFs, and payments.

Apps do not each keep their own copy of a client or an invoice. They read and write these tables. A function runs with server privileges when the phone or the browser must not see a secret (Stripe, Twilio, the PDF lookup).

Nothing here is a screen. If a task is "move a button", it belongs in an app. If a task is "the customer opened the link and should see the PDF", it belongs here.

## Accounts and company

Owners sign up with email. The profile stores the company name, logo, address, phone, email, and the one country they serve. Triggers fill the country on new addresses. The owner cannot switch country later by editing the profile.

Employees do not get an owner account. They prove their phone with a one-time text code.

Customers of the cleaning company can get a magic link into the client portal.

## Requests

`create-booking` saves a public request and emails the visitor. A second confirmation email must not be sent from the app on that same submit. `send-booking-emails` is for other sends, such as a manual resend. The owner is also notified in the app.

## Estimates and quick quotes

| Function | What it does |
|---|---|
| `send-estimate-email` | Emails the customer and the owner. View opens the PDF. Accept is a separate button. |
| `send-estimate-sms` | Texts the link the app already built |
| `send-quick-quote-email` | Same idea for a quote. View opens the PDF. |
| `send-quick-quote-sms` | Builds the quote link on the server and texts it |
| `accept-estimate` / `accept-quick-quote` | Records that the customer accepted |
| `download-estimate-pdf` | Builds the estimate or quote sheet and shows it in the browser |
| `mark-viewed` | Records that the email was opened |

The sheet uses the company profile and the estimate or quote: rooms or services, prices, discount, deposit, and balance. The footer is Thunder Pro.

## Invoices and payments

| Function | What it does |
|---|---|
| `send-invoice-email` | Emails the invoice. Pay opens checkout. Download shows the PDF. A paid invoice can instead send a receipt. |
| `send-invoice-sms` | Texts a link that opens the PDF |
| `send-invoice-reminders` | Reminds the customer to pay. That link stays the payment page. |
| `download-invoice-pdf` | Builds the invoice sheet (number, dates, title, tax, notes) and shows it in the browser |
| `stripe-create-checkout` | Starts card payment for a public invoice |
| `stripe-webhook` | Marks the invoice paid when Stripe confirms it |
| `process-invoice-payment` | Server-side payment completion |
| `stripe-onboard`, `stripe-check-account`, `stripe-dashboard-link` | Connects the owner's Stripe account so they can get paid |

The Pay button and the PDF button are different. Pay must keep going to checkout.

## Jobs

Functions email or text the customer when a job's status changes, when an estimate becomes a job, and when a job is due. Assigned employees can be notified. The database also creates the next visit in a repeating series and can cancel the series.

## Schedule

Appointment functions email and text the customer, including day-before reminders and a scheduled batch.

## Walkthroughs

Functions confirm, update, cancel, complete, and remind. Each has an email version and, where needed, a text version. Converting a walkthrough can notify the people involved.

## Contracts

`send-contract-email` and `send-contract-sms` deliver the agreement. `download-contract-pdf` returns the file. `accept-contract` records the signature. A scheduled function expires contracts that ran out.

## Employees and time clock

| Function | What it does |
|---|---|
| `validate-employee-phone` | Checks that the phone belongs to an active employee |
| `send-employee-otp` / `verify-employee-otp` | Sends and checks the login code |
| `resend-employee-invite`, `send-employee-welcome-email` | Invite and welcome |
| `get-scheduled-shifts` | Today's assigned work for the employee app |
| `employee-clock-action` | Clock in, break, and clock out. The server writes the timestamps and the hours. |
| `get-active-clock-session` | The shift that is open right now |
| `get-employee-time-history` | Past shifts |
| `upload-shift-photo` | Before and after photos |
| `send-clock-notifications` | Tells the owner about clock activity |
| `send-timesheet-email`, `send-timesheet-sms` | Sends a timesheet |

The clock function still identifies work by the route appointment. The employee app hides that and talks about jobs.

## Client portal

`validate-client-portal-magic-link` signs the customer in. Wallet functions list saved cards, start a card-setup checkout, and issue a token for the wallet page.

## Other mail and safety

Verification email, password reset, and the signup welcome. `handle-email-bounce` records a bad address. `verify-recaptcha` protects public forms. `geocode-address` turns a street address into coordinates and rejects a point outside the owner's country. Push functions register a device and send a notification.

## Plans

`revenuecat-webhook` and `update-subscription` record the store subscription. The apps decide which buttons to lock. The database is not what hides a menu.

## Email and SMS

Every email and text is sent from a function in this repo. The dashboard and the phone app only call that function. To change a subject, a sentence, or a link, edit the function in the table and deploy it.

The same list is copied into `thunder_dashboard/FEATURES.md` and `swift-slate/FEATURES.md` so an agent working in those apps can see it. If a line here and a line there disagree, the function code wins.

### Account

| When | To | Channel | Subject or text | Function |
|---|---|---|---|---|
| Owner signs up | Owner | Email | Verify Your Thunder Pro Email Address | `send-verification-email` |
| Owner signs up | Owner | Email | Welcome to Thunder Pro — schedule your demo | `send-signup-welcome` |
| Owner signs up | Owner | SMS | Hi {name}, this is Javier from Thunder Pro, with a Calendly demo link | `send-signup-welcome` |
| A profile row is created | Thunder Pro internal inbox | Email | New Thunder Pro user registration | `notify-internal-registration` |
| Owner asks to reset a password | Owner | Email | Reset Your Thunder Pro Password | `send-password-reset-email` |

### Requests

`create-booking` calls `send-booking-status-emails` after the row is saved. The app must not send a second confirmation on that same submit.

| When | To | Channel | Subject or text | Function |
|---|---|---|---|---|
| Request is created | Visitor | Email | Request Confirmation - {company} | `send-booking-status-emails` |
| Request is created | Owner | Email | 🎉 New Request - {name} | `send-booking-status-emails` |
| Request is converted | Visitor | Email | Update — your request with {company} | `send-booking-status-emails` |
| Request is converted | Owner | Email | Request converted — {name} | `send-booking-status-emails` |
| Request is cancelled | Visitor / owner | Email | Request cancelled — {company} / Request cancelled — {name} | `send-booking-status-emails` |
| Request is archived | Visitor / owner | Email | Request archived — {company} / Request archived — {name} | `send-booking-status-emails` |
| Request is restored | Visitor / owner | Email | Request restored — {company} / Request restored — {name} | `send-booking-status-emails` |
| Another status change | Visitor / owner | Email | Request update — {company} / Request status {status} — {name} | `send-booking-status-emails` |
| Older booking mail, including a manual resend | Visitor | Email | Booking Confirmation - {company} | `send-booking-emails` |
| Older booking mail | Owner | Email | 🎉 New Lead Request - {name} requesting {service} | `send-booking-emails` |

### Estimates

The owner sends these from the estimate screen. View opens `download-estimate-pdf`. Accept calls `accept-estimate`.

| When | To | Channel | Subject or text | Function |
|---|---|---|---|---|
| First residential send | Customer | Email | Residential Cleaning Estimate - {company} | `send-estimate-email` |
| First commercial send | Customer | Email | Commercial Cleaning Estimate - {company} | `send-estimate-email` |
| Update | Customer | Email | You have an Updated estimate - {company} | `send-estimate-email` |
| First send or update | Owner | Email | An estimate was sent to {client} / An estimate was updated for {client} | `send-estimate-email` |
| First text | Customer | SMS | Hi {name}, your cleaning estimate{total} is ready. View it here: {pdf url} | `send-estimate-sms` |
| Updated text | Customer | SMS | Hi {name}, your cleaning estimate{total} has been updated. View it here: {pdf url} | `send-estimate-sms` |
| Customer accepts | Owner | Email | Estimate accepted — {number} | `accept-estimate` |

Estimate SMS pastes the URL the app already built. The email builds its own PDF link. An update uses the same card with the banner ESTIMATE UPDATE. The customer gets Accept Estimate and View Estimate. The owner gets Download PDF. The customer text says "{company} has updated your estimate." The owner text says "Your estimate for {client} has been successfully updated."

### Quick quotes

| When | To | Channel | Subject or text | Function |
|---|---|---|---|---|
| First send | Recipient | Email | Cleaning Quote - {company} | `send-quick-quote-email` |
| Update | Recipient | Email | You have an Updated quote - {company} | `send-quick-quote-email` |
| First send or update | Owner | Email | A quote was sent to {name} / A quote was updated for {name} | `send-quick-quote-email` |
| Text | Recipient | SMS | Hi {name}, your cleaning estimate{total} is ready. View it here: {pdf url} | `send-quick-quote-sms` |
| Updated text | Recipient | SMS | Hi {name}, your cleaning estimate{total} has been updated. View it here: {pdf url} | `send-quick-quote-sms` |
| Recipient accepts | Owner | Email | Quote accepted — {number} | `accept-quick-quote` |

The quote text still says "cleaning estimate". The email subject says Quote. The link is `download-estimate-pdf`. The server ignores a URL sent by the app.

### Invoices

| When | To | Channel | Subject or text | Function |
|---|---|---|---|---|
| Owner sends the invoice | Customer | Email | {company} sent you an invoice | `send-invoice-email` |
| Owner sends an update | Customer | Email | You have an Updated invoice - {company} | `send-invoice-email` |
| Those sends | Owner | Email | Invoice sent to {client} / Invoice updated for {client} | `send-invoice-email` |
| Owner texts the invoice | Customer | SMS | Hi {name}, your invoice{total} is ready. View it here: {pdf url} | `send-invoice-sms` |
| Owner texts an update | Customer | SMS | Hi {name}, your invoice{total} has updates and is ready. View it here: {pdf url} | `send-invoice-sms` |
| Invoice is paid (Stripe checkout, saved card, or `process-invoice-payment`) | Customer | Email | Payment received — Invoice {number} | `send-invoice-email` with `isPaymentConfirmation` |
| Invoice is paid | Owner | Email | Invoice paid: {number} — {client} | `send-invoice-email` with `isPaymentConfirmation` |
| Due today, once a day at 9:00 UTC, or the owner taps Remind | Customer | Email | {company} sent you a invoice reminder | `send-invoice-reminders` |
| That reminder | Owner | Email | A reminder invoice was sent to {client} | `send-invoice-reminders` |

The invoice email has Pay (`/invoice/payment/:token`) and Download PDF (`download-invoice-pdf`). The text opens the PDF. The reminder email keeps Pay Now on the payment page. There is no invoice reminder SMS.

### Jobs

Stored statuses: `draft`, `scheduled`, `upcoming`, `today`, `ongoing`, `missed`, `completed`, `cancelled`. The dashboard and the phone app show both `upcoming` and `today` as Upcoming. `ongoing` is a stored value the apps show as Today. Nothing in the current flow writes `jobs.status = ongoing`.

#### How the status changes

| From | To | What does it |
|---|---|---|
| — | `draft` | Create, on the dashboard or the phone. Also the row created when an estimate or walkthrough is converted. |
| `draft` | `upcoming` | Owner publishes. The app updates the status to upcoming. If the date is after today in the owner's timezone, it stays `upcoming`. |
| `draft` | `today` | Same publish, when the date is today. A before-update trigger rewrites upcoming/today/missed from the date. |
| `scheduled` | `upcoming` or `today` | A future visit of a recurring series. `refresh_job_temporal_statuses` runs every 30 minutes and moves it when its date arrives. |
| `upcoming` | `today` | That same 30-minute job, once the date is today. |
| `upcoming` or `today` | `missed` | That same job, once the start is at least 6 hours in the past, or the date has passed. |
| any except `completed` and `cancelled` | `completed` | Owner marks it complete, or the employee clocks out of that job (`employee-clock-action`). |
| active statuses | `cancelled` | Owner cancels. A recurring cancel goes through `manage_recurring_job` / `cancel_recurring_job_series`. |
| — | `ongoing` | Not used. Clock-in sets the time entry to `in_progress` and leaves the job status alone. `ongoing` is written only on `route_appointments`, and only when the time entry is tied to that appointment. |

Publishing a future job is `draft` → `upcoming`. Publishing a job for today is `draft` → `today`. Creating the row does not publish it.

#### Who gets email and SMS

`on_job_status_change_send_email` runs after `jobs.status` changes and calls `dispatch_job_status_email`, which posts to `send-job-status-emails` at `http://kong:8000`. `send-job-status-emails` and `send-job-status-sms` have `verify_jwt = false`, same as the employee notification. Cancel also calls the email function from the app, so a cancel can send the same email twice.

The function skips `upcoming` → `today`, `today` → `missed`, and `upcoming` → `missed`. Those are the automatic date moves, so the client and the owner get no status email for them.

| When | To | Channel | Subject or text | Function |
|---|---|---|---|---|
| Status becomes `upcoming` or `today` from `draft` or `scheduled` | Customer | Email | Your job has been confirmed — {company}. Banner JOB CONFIRMED. Pay Deposit when a deposit is required | `send-job-status-emails` |
| That confirmation | Customer | SMS | {company}: Hi {name}, your job has been confirmed and assigned to our team | `send-job-status-emails` |
| That confirmation | Owner | Email | The job for {client} has been confirmed — {company}. Banner JOB CONFIRMED | `send-job-status-emails` |
| That confirmation | Owner | SMS | {company}: Hi {name}, the job for {client} has been confirmed and assigned to your team | `send-job-status-emails` |
| Publish from `draft` with employees assigned | Employee | Email | You've been assigned a new job — {company}. Banner ASSIGNED JOB | `notify-job-employees` |
| That publish | Employee | SMS | {company}: Hi {name}, you've been assigned a new job for {client} | `notify-job-employees` |
| Status becomes `upcoming` from `upcoming`, `today`, `ongoing`, or `missed` | Customer | Email | Your job has been rescheduled — {company} | `send-job-status-emails` |
| `completed` | Customer | Email | Your job has been completed — {company}. May include View invoice and pay | `send-job-status-emails` |
| `cancelled` | Customer | Email | Your job has been cancelled — {company} | `send-job-status-emails` |
| Any other status change the function does not skip | Owner | Email | Job {number} status {status} — {company}, or Job {number} completed | `send-job-status-emails` |
| `upcoming` that is not a first confirmation, or `cancelled` | Employee | Email | Job assigned — {number} / Job cancelled — {number} | `send-job-status-emails` |
| Estimate or walkthrough is linked to the new draft | Owner | Email | Job created from {source} — {number} | `send-job-conversion-emails` |
| That link | Customer | Email | Your {source} was moved to a job with {company} | `send-job-conversion-emails` |
| Day before, job still `upcoming`, cron at 9:00 UTC | Customer | Email | Your job is scheduled for tomorrow — {company}. Banner JOB REMINDER TOMORROW. Pay Deposit and Download PDF when the deposit is still unpaid | `send-job-reminders` |
| That day-before reminder | Owner | Email | {client}'s job is scheduled for tomorrow — {company}. Banner JOB REMINDER TOMORROW. Pending Deposit when the deposit is still unpaid | `send-job-reminders` |
| About 1 hour before the start, checked every 5 minutes | Customer | Email | Your job is scheduled to start in one hour — {company}. Banner JOB REMINDER TODAY. Pay Deposit and Download PDF when the deposit is still unpaid | `send-job-reminders` |
| That one-hour reminder | Owner | Email | {client}'s job is scheduled to start in one hour — {company}. Banner JOB REMINDER TODAY. Pending Deposit when the deposit is still unpaid | `send-job-reminders` |
| Tomorrow reminder, and the one-hour reminder | Employee | Email | Recordatorio de trabajo — mañana/hoy — {number} | `send-job-reminders` |
| Insert of a non-draft job that already has employees, or the employee list changes | Employee | Push, then email | You've been assigned a new job — {company} | `notify-job-employees` |
| Date or start time changes on an active job | Employee | Push, then email | Job rescheduled — {number} | `notify-job-employees` |
| Status becomes `cancelled` and employees are assigned | Employee | Push, then email | Job cancelled — {number} | `notify-job-employees` |
| Those employee events, when the employee has a phone | Employee | SMS | Assigned uses the Thunder Crew sentence. Reschedule and cancel keep the short text | `notify-job-employees` |

Publishing from the owner app calls `send-job-status-emails` with the status the database saved. A job for today is saved as `today`, and a later job is saved as `upcoming`. Both send the confirmation card to the client and the owner. The status trigger calls the same function. `jobs.confirmation_notified_at` keeps that to one send.

On confirmation, the customer email is sent when `jobs.client_email` is set and `client_notification_channel` is null, `email`, or `both`. The customer SMS is sent when `jobs.client_phone` is set and the channel is null, `sms`, or `both`. Neither app writes that column, so it stays null and both go out. Other statuses still email the customer only when the channel is null or `email`.

`send-job-status-sms` still texts the customer for `upcoming`, `cancelled`, and `completed`, and uses the confirmation sentence when the job is first published. The confirmation SMS itself is sent by `send-job-status-emails`, so the apps do not call the SMS function. Download PDF on the client and owner confirmation opens `download-job-pdf` inline, using the job id as the token. The sheet follows the estimate PDF. Pay Deposit opens the deposit invoice payment page. That invoice is created as Pending, stays on `jobs.deposit_invoice_id`, and becomes Paid when Stripe confirms the payment. Paying it sends the DEPOSIT PAID card to the client and the owner. Cancelling the job sends the JOB CANCELLED card to the client and the owner. Both cards include Download PDF.

A job published for today (`draft` → `today`) uses the confirmation card. `upcoming` → `today`, `missed`, and `ongoing` do not email the customer. `upcoming` → `today` and the missed moves send nothing.

The conversion email goes out when `estimates.job_id` or `walkthroughs.job_id` is set, while the job is still a draft. Publishing that job later still sends the confirmation email.

The day-before reminder emails the owner and the customer at 9:00 UTC with the JOB REMINDER TOMORROW card. The today reminder is not based on when the job was created. It goes out about one hour before the scheduled start, checked every 5 minutes, with the JOB REMINDER TODAY card. A job with no start time is skipped. A deposit invoice that is not Paid shows Pending Deposit on the owner email, and Deposit plus Pay Deposit and Download PDF on the customer email. A paid deposit omits that line and those buttons. Employee reminders stay on the older Spanish template and go out at the same time as the owner and customer reminder. Other job mail is English.

Each send writes a line to the edge-runtime log starting with `[job-message]`. `origin` is `converted_estimate` when the job has `estimate_id`, `converted_walkthrough` when it has `walkthrough_id`, and `created` when the owner made the job directly. Filter with `docker logs supabase_edge_runtime_euydrdzayvjahstvmwoj 2>&1 | grep job-message`.

Clock-in writes an in-app notification for the owner (`job_started`) and does not change the job status. `send-clock-notifications` emails the owner and the customer only when the time entry is linked to a `route_appointments` row. A job clock-in from the employee app sends `job_id` and does not take that path. Clock-out sets the job to `completed`, which is a normal status email.

### Schedule

| When | To | Channel | Subject or text | Function |
|---|---|---|---|---|
| Owner saves or updates an appointment | Owner | Email | New Service Appointment - {client} / Service Appointment Updated - {client} | `send-appointment-emails` |
| Same | Customer | Email | Service Appointment Confirmation - {date} / Service Appointment Updated - {date} | `send-appointment-emails` |
| Same | Employee | Email | New Service Assignment - {date} / Service Assignment Updated - {date} | `send-appointment-emails` |
| Same | Customer | SMS | Update from {company}: Your job scheduled for {date} has been assigned and is on route… / has been updated. Link is the appointment PDF | `send-appointment-sms` |
| Same | Employee | SMS | New job assigned for {date}! / Job updated for {date}! Plus client, address, service, and the employee app link | `send-appointment-sms` |
| Every day at 8:00 UTC, for today's appointments | Customer | Email | Service Appointment Confirmation - {date} | `send-scheduled-appointment-emails` |
| When the reminder function runs, 24 hours before | Owner | Email | 24-Hour Reminder - Service Tomorrow | `send-appointment-reminders` |
| 24 hours before | Customer | Email | Reminder: Your Service is Tomorrow | `send-appointment-reminders` |
| 24 hours before | Employee | Email | Service Reminder - Tomorrow | `send-appointment-reminders` |
| 1 hour before | Owner | Email | Service Starting Soon - 1 Hour | `send-appointment-reminders` |
| 1 hour before | Customer | Email | We're On Our Way! | `send-appointment-reminders` |

### Walkthroughs

| When | To | Channel | Subject or text | Function |
|---|---|---|---|---|
| Scheduled | Owner and customer | Email | Walkthrough confirmed | `send-walkthrough-confirmation` |
| Scheduled | Customer | SMS | A New walkthrough is scheduled with {employee} on {date} at {time} | `send-walkthrough-confirmation-sms` |
| Rescheduled | Owner and customer | Email | Walkthrough Appointment Updated | `send-walkthrough-update` |
| Rescheduled | Customer | SMS | Update from {company}: Your walkthrough appointment has been rescheduled to {date} at {time} | `send-walkthrough-update-sms` |
| Started | Owner and customer | Email | Good news, the walkthrough has started !! | `send-walkthrough-start` |
| Started | Customer | SMS | Good news! The walkthrough with {employee} has started on {date} at {time} | `send-walkthrough-start-sms` |
| Completed | Owner | Email | Congratulations! Walkthrough Completed | `send-walkthrough-completion` |
| Completed | Customer | Email | Your Estimate is Being Prepared | `send-walkthrough-completion` |
| Completed | Customer | SMS | Thank you! Your walkthrough with {company} has been completed… | `send-walkthrough-completion-sms` |
| Cancelled | Owner and customer | Email | Walkthrough Successfully Cancelled | `send-walkthrough-cancellation` |
| Cancelled | Customer | SMS | We're sorry, but your walkthrough appointment with {company} has been cancelled… | `send-walkthrough-cancellation-sms` |
| Converted to an estimate | Owner | Email | Walkthrough converted — estimate linked | `send-walkthrough-converted` |
| Converted | Customer | Email | Your estimate is on the way | `send-walkthrough-converted` |
| Day before, 9:00 UTC | Owner and customer | Email | Walkthrough reminder - Tomorrow | `send-walkthrough-day-before-reminders` |
| Day before | Owner | SMS | Reminder: Walkthrough with {name} scheduled for tomorrow ({date}) at {time} | `send-walkthrough-day-before-reminders` |
| Day before | Customer | SMS | A New walkthrough is schedule with {employee} on {date} at {time} | `send-walkthrough-day-before-reminders` |
| About 1 hour before (checked every 5 minutes) | Owner and customer | Email | The walkthrough starts in 1 hour. | `send-walkthrough-reminders` |

`send-walkthrough-status-emails` is the switch: it calls the confirmation, completion, cancellation, or converted function for that status.

### Contracts

| When | To | Channel | Subject or text | Function |
|---|---|---|---|---|
| Owner sends the agreement | Customer | Email | Service Agreement - {company} | `send-contract-email` |
| Owner texts it | Customer | SMS | Hi {name}, your service agreement{total} is ready. View and download here: {url} | `send-contract-sms` |
| Owner texts an update | Customer | SMS | Hi {name}, your service agreement{total} has been updated. View and download here: {url} | `send-contract-sms` |
| Customer accepts | Owner | Email | Contract accepted — {number} | `accept-contract` |
| One month before the end date, daily at 9:00 UTC | Owner | Email | Contract {number} expires in one month ({date}) | `process-contract-expirations` |

### Employees and time clock

| When | To | Channel | Subject or text | Function |
|---|---|---|---|---|
| Employee asks for a login code | Employee | SMS | Your verification code is: {code}. This code will expire in 10 minutes. | `send-employee-otp` |
| Owner invites or resends | Employee | SMS | Hi {name}! Welcome to the {company} team. Download the Thunder Pro employee app… | `send-employee-sms` |
| Owner invites or resends | Employee | Email | Welcome to the {company} team | `send-employee-welcome-email` |
| A timesheet is sent | Employee | Email | Your Timesheet - {dates} | `send-timesheet-email` |
| A timesheet is texted | Employee | SMS | Hi {name}, your timesheet is ready. View it here: {pdf url} | `send-timesheet-sms` |
| Clock in on an assigned service | Owner | Email | Service Started | `send-clock-notifications` |
| Clock in on an assigned service | Customer | Email | Your Service Has Started | `send-clock-notifications` |
| Clock out on an assigned service | Owner | Email | Service Completed | `send-clock-notifications` |
| Clock out on an assigned service | Customer | Email | Service Completed - Thank You! | `send-clock-notifications` |
| Clock in with no service | Owner | Email | Employee Clock In - {name} | `send-clock-notifications` |
| Clock out with no service | Owner | Email | Employee Clock Out - {name} | `send-clock-notifications` |

`employee-clock-action` calls `send-clock-notifications`. `resend-employee-invitation` calls the welcome SMS and the welcome email.

### Client portal

| When | To | Channel | Subject or text | Function |
|---|---|---|---|---|
| Customer asks for a login link | Customer | Email | Your Thunder Pro client portal link | `request-client-portal-magic-link` |

The page always answers that a registered email will receive a link. There is no portal SMS.

### Daily sales

| When | To | Channel | Subject or text | Function |
|---|---|---|---|---|
| The report function runs and there are paid invoices that day | Owner | Email | {company} —Your Daily Sales Summary Report | `send-daily-sales-report` |

### Samples

`send-sample-emails`, `send-payment-sample-emails`, `send-sample-walkthrough-emails`, `send-start-walkthrough-samples`, `send-completion-walkthrough-samples`, and `send-cancellation-samples` send preview copies to a test address. They are not a customer flow.

## How a customer link is chosen

| They should | Host |
|---|---|
| See an estimate or quote PDF | This server, `download-estimate-pdf` |
| See an invoice PDF | This server, `download-invoice-pdf` |
| Pay an invoice | `dashboard.thunderpro.co/invoice/payment/...` |
| Read marketing pages | `thunderpro.co` |

A PDF that should appear on screen is returned inline. A file marked as a download attachment makes the phone save it instead of showing it.
