import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { personFirstName } from "../_shared/documentEmailCard.ts";
import { formatDateOnlyLong } from "../_shared/formatDateOnly.ts";
import {
  clientJobConfirmedSms,
  employeeJobAssignedSms,
  formatJobClock,
  isJobConfirmation,
  jobFrequencyLabel,
  jobHasDeposit,
  jobPropertyAddress,
  jobServiceLabel,
  ownerJobConfirmedSms,
  renderJobNoticeEmail,
  type JobNotice,
} from "../_shared/jobConfirmationCard.ts";
import { jobOrigin, logJobMessage } from "../_shared/jobMessageLog.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type ClientChannel = "email" | "sms" | "both" | null;

interface StatusPayload {
  jobId: string;
  previousStatus: string;
  newStatus: string;
  clientChannel?: ClientChannel;
}

type JobRow = {
  id: string;
  job_number: string | null;
  status: string;
  user_id: string;
  service_type: string;
  scheduled_date: string;
  start_time: string | null;
  end_time: string | null;
  total_amount: number | null;
  balance_due: number | null;
  client_name: string | null;
  client_email: string | null;
  property_street: string | null;
  property_apt: string | null;
  property_city: string | null;
  property_state: string | null;
  property_zip: string | null;
  assigned_employees: string[] | unknown;
  invoice_ids: string[] | null;
  client_phone: string | null;
  job_type: string | null;
  recurring_frequency: string | null;
  deposit_required: boolean | null;
  deposit_amount: number | null;
  deposit_invoice_id: string | null;
  estimate_id?: string | null;
  walkthrough_id?: string | null;
};

type EmployeeRow = {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
};

const EMPLOYEE_NOTIFY_STATUSES = new Set(["upcoming", "cancelled"]);
const CLIENT_NOTIFY_STATUSES = new Set(["upcoming", "cancelled", "completed"]);

function isAutoTemporalTransition(previousStatus: string, newStatus: string): boolean {
  return (
    (previousStatus === "upcoming" && newStatus === "today") ||
    (previousStatus === "today" && newStatus === "missed") ||
    (previousStatus === "upcoming" && newStatus === "missed")
  );
}

function shouldSendClientEmail(channel: ClientChannel | undefined): boolean {
  if (!channel || channel === "email") return true;
  return false;
}

async function sendEmailViaSMTP(
  toEmail: string,
  subject: string,
  htmlContent: string,
  replyToEmail: string | null = null,
): Promise<void> {
  const smtpHost = "email-smtp.us-east-2.amazonaws.com";
  const smtpPort = 587;
  const smtpUser = Deno.env.get("AWS_SES_SMTP_USERNAME") || "";
  const smtpPass = Deno.env.get("AWS_SES_SMTP_PASSWORD") || "";
  const fromEmail = Deno.env.get("AWS_SES_FROM_EMAIL") || '"Thunder Pro" <info@thunderpro.co>';

  if (!smtpUser || !smtpPass) {
    throw new Error("AWS SES SMTP credentials are missing.");
  }

  let conn: Deno.TcpConn | null = null;
  let tlsConn: Deno.TlsConn | null = null;

  try {
    conn = await Deno.connect({ hostname: smtpHost, port: smtpPort });
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const readResponse = async (connection: Deno.TcpConn | Deno.TlsConn): Promise<string> => {
      const buffer = new Uint8Array(4096);
      const n = await connection.read(buffer);
      return decoder.decode(buffer.subarray(0, n || 0));
    };

    const sendCommand = async (connection: Deno.TcpConn | Deno.TlsConn, command: string): Promise<string> => {
      await connection.write(encoder.encode(command + "\r\n"));
      const response = await readResponse(connection);
      const responseCode = response.substring(0, 3);
      if (responseCode.startsWith("4") || responseCode.startsWith("5")) {
        throw new Error(`SMTP Error ${responseCode}: ${response.trim()}`);
      }
      return response;
    };

    await readResponse(conn);
    await sendCommand(conn, "EHLO thunderpro.co");
    await sendCommand(conn, "STARTTLS");
    tlsConn = await Deno.startTls(conn, { hostname: smtpHost });
    await sendCommand(tlsConn, "EHLO thunderpro.co");
    await tlsConn.write(encoder.encode("AUTH LOGIN\r\n"));
    await readResponse(tlsConn);
    await sendCommand(tlsConn, btoa(smtpUser));
    await sendCommand(tlsConn, btoa(smtpPass));
    await sendCommand(tlsConn, "MAIL FROM:<info@thunderpro.co>");
    await sendCommand(tlsConn, `RCPT TO:<${toEmail}>`);
    await sendCommand(tlsConn, "DATA");

    const messageId = `<${Date.now()}.${Math.random().toString(36).substring(2, 15)}@thunderpro.co>`;
    const headers = [
      `From: ${fromEmail}`,
      `To: ${toEmail}`,
      ...(replyToEmail ? [`Reply-To: ${replyToEmail}`] : []),
      `Subject: ${subject}`,
      `Message-ID: ${messageId}`,
      "MIME-Version: 1.0",
      "Content-Type: text/html; charset=UTF-8",
      "",
    ].join("\r\n");

    await tlsConn.write(encoder.encode(headers + "\r\n"));
    const contentBytes = encoder.encode(htmlContent);
    for (let i = 0; i < contentBytes.length; i += 4096) {
      const chunk = contentBytes.slice(i, Math.min(i + 4096, contentBytes.length));
      await tlsConn.write(chunk);
    }
    await tlsConn.write(encoder.encode("\r\n.\r\n"));
    await readResponse(tlsConn);
    await sendCommand(tlsConn, "QUIT");
    tlsConn.close();
  } catch (error: unknown) {
    try {
      if (tlsConn) tlsConn.close();
      if (conn) conn.close();
    } catch {
      // ignore close errors
    }
    throw error;
  }
}

function titleCaseStatus(status: string): string {
  if (!status) return "";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function formatTime(timeStr: string | null): string {
  if (!timeStr) return "TBD";
  const [hours, minutes] = timeStr.split(":");
  const hour = parseInt(hours, 10);
  const ampm = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${minutes} ${ampm}`;
}

function formatDate(dateStr: string, timezone = "America/New_York"): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const dateAtMidday = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: timezone,
  }).format(dateAtMidday);
}

function formatAddress(job: JobRow): string {
  const apt = job.property_apt ? ` ${job.property_apt}` : "";
  const cityStateZip = [job.property_city, job.property_state, job.property_zip].filter(Boolean).join(", ");
  return [job.property_street ? `${job.property_street}${apt}` : "", cityStateZip].filter(Boolean).join(", ");
}

function formatSchedule(job: JobRow, timezone: string): string {
  const date = formatDate(job.scheduled_date, timezone);
  const start = formatTime(job.start_time);
  const end = job.end_time ? ` – ${formatTime(job.end_time)}` : "";
  return `${date} at ${start}${end}`;
}

function wrapEmail(title: string, body: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:20px;font-family:Arial,sans-serif;background:#f9fafb;">
  <div style="max-width:640px;margin:0 auto;background:#fff;border-radius:10px;overflow:hidden;border:1px solid #e5e7eb;">
    <div style="padding:16px 20px;background:#111827;color:#fff;">
      <h2 style="margin:0;font-size:20px;">${title}</h2>
    </div>
    <div style="padding:20px;color:#111827;line-height:1.6;">${body}</div>
    <div style="padding:12px 20px;background:#f3f4f6;color:#6b7280;font-size:12px;">
      Thunder Pro automatic notification
    </div>
  </div>
</body>
</html>`;
}

function buildOwnerEmail(
  job: JobRow,
  companyName: string,
  previousStatus: string,
  newStatus: string,
): { subject: string; html: string } {
  const clientName = job.client_name || "Client";
  const details = `
    <p><strong>Job:</strong> ${job.job_number || job.id}</p>
    <p><strong>Status:</strong> ${titleCaseStatus(previousStatus)} → ${titleCaseStatus(newStatus)}</p>
    <p><strong>Service:</strong> ${job.service_type}</p>
    <p><strong>Date:</strong> ${job.scheduled_date}</p>
    <p><strong>Time:</strong> ${job.start_time || "N/A"}${job.end_time ? ` - ${job.end_time}` : ""}</p>
    <p><strong>Property:</strong> ${formatAddress(job) || "N/A"}</p>
    <p><strong>Total:</strong> $${(job.total_amount ?? 0).toFixed(2)} | <strong>Balance Due:</strong> $${(job.balance_due ?? 0).toFixed(2)}</p>
  `;

  const subject = newStatus === "completed"
    ? `Job ${job.job_number || ""} completed — ${companyName}`.trim()
    : `Job ${job.job_number || ""} status ${titleCaseStatus(newStatus)} — ${companyName}`.trim();

  const title = newStatus === "completed" ? "Job completed" : "Job status updated";
  const intro = newStatus === "completed"
    ? `<p>The job for <strong>${clientName}</strong> has been marked as <strong>Completed</strong>.</p>`
    : `<p>The job for <strong>${clientName}</strong> changed from <strong>${titleCaseStatus(previousStatus)}</strong> to <strong>${titleCaseStatus(newStatus)}</strong>.</p>`;

  return {
    subject,
    html: wrapEmail(title, `${intro}${details}`),
  };
}

function buildClientEmail(
  job: JobRow,
  companyName: string,
  newStatus: string,
  previousStatus: string,
  timezone: string,
  paymentLink: string | null,
): { subject: string; html: string } | null {
  const clientName = job.client_name || "Client";
  const schedule = formatSchedule(job, timezone);
  const address = formatAddress(job) || "N/A";

  if (newStatus === "completed") {
    const invoiceBlock = paymentLink
      ? `<p style="margin-top:20px;"><a href="${paymentLink}" style="display:inline-block;background:#1e3a8a;color:#fff;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:bold;">View invoice and pay</a></p>`
      : "";
    return {
      subject: `Your job has been completed — ${companyName}`,
      html: wrapEmail(
        "Job completed",
        `<p>Hi ${clientName},</p>
        <p><strong>Your job has been completed.</strong></p>
        <p>Thank you for choosing ${companyName}. We hope everything met your expectations.</p>
        ${invoiceBlock}`,
      ),
    };
  }

  if (newStatus === "cancelled") {
    return {
      subject: `Your job has been cancelled — ${companyName}`,
      html: wrapEmail(
        "Job cancelled",
        `<p>Hi ${clientName},</p>
        <p>Your job scheduled for <strong>${schedule}</strong> has been <strong>cancelled</strong>.</p>
        <p><strong>Address:</strong> ${address}</p>
        <p>If you have any questions, please contact us directly.</p>`,
      ),
    };
  }

  if (newStatus === "upcoming") {
    const isReschedule = ["upcoming", "today", "ongoing", "missed"].includes(previousStatus);
    const title = isReschedule ? "Job rescheduled" : "Job confirmed";
    const intro = isReschedule
      ? `<p>Hi ${clientName},</p><p>Your job has been <strong>rescheduled</strong>.</p>`
      : `<p>Hi ${clientName},</p><p>Your job has been <strong>confirmed</strong>.</p>`;

    return {
      subject: isReschedule
        ? `Your job has been rescheduled — ${companyName}`
        : `Your job has been confirmed — ${companyName}`,
      html: wrapEmail(
        title,
        `${intro}
        <p><strong>Date and time:</strong> ${schedule}</p>
        <p><strong>Address:</strong> ${address}</p>
        <p>We look forward to seeing you. If you need to make any changes, please contact us.</p>`,
      ),
    };
  }

  return null;
}

function buildEmployeeEmail(
  job: JobRow,
  employee: EmployeeRow,
  companyName: string,
  newStatus: string,
  timezone: string,
): { subject: string; html: string } {
  const clientName = job.client_name || "Client";
  const schedule = formatSchedule(job, timezone);
  const address = formatAddress(job) || "N/A";
  const employeeName = `${employee.first_name} ${employee.last_name}`.trim();

  if (newStatus === "cancelled") {
    return {
      subject: `Job cancelled — ${job.job_number || companyName}`,
      html: wrapEmail(
        "Job cancelled",
        `<p>Hi ${employeeName},</p>
        <p>The following assigned job has been <strong>cancelled</strong>:</p>
        <p><strong>Client:</strong> ${clientName}</p>
        <p><strong>Date/Time:</strong> ${schedule}</p>
        <p><strong>Address:</strong> ${address}</p>`,
      ),
    };
  }

  return {
    subject: `Job assigned — ${job.job_number || companyName}`,
    html: wrapEmail(
      "Job assignment",
      `<p>Hi ${employeeName},</p>
      <p>You have been assigned to a job:</p>
      <p><strong>Client:</strong> ${clientName}</p>
      <p><strong>Date/Time:</strong> ${schedule}</p>
      <p><strong>Address:</strong> ${address}</p>
      <p><strong>Service:</strong> ${job.service_type}</p>`,
    ),
  };
}

function normalizeEmployeeIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => (typeof item === "string" ? item : (item as { id?: string })?.id))
    .filter((id): id is string => typeof id === "string" && id.length > 0);
}

async function resolveInvoicePaymentLink(
  supabase: ReturnType<typeof createClient>,
  invoiceIds: string[] | null | undefined,
): Promise<string | null> {
  if (!invoiceIds?.length) return null;

  const { data: invoice } = await supabase
    .from("invoices")
    .select("id, payment_token")
    .in("id", invoiceIds)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!invoice) return null;

  const publicAppUrl = Deno.env.get("PUBLIC_APP_URL") ||
    Deno.env.get("APP_URL") ||
    "https://app.staging.thunderpro.co";
  return `${publicAppUrl}/invoice/payment/${invoice.payment_token || invoice.id}`;
}

async function resolveDepositPaymentLink(
  supabase: ReturnType<typeof createClient>,
  depositInvoiceId: string | null | undefined,
): Promise<string | null> {
  if (!depositInvoiceId) return null;
  const { data: invoice } = await supabase
    .from("invoices")
    .select("id, payment_token")
    .eq("id", depositInvoiceId)
    .maybeSingle();
  if (!invoice) return null;
  const publicAppUrl = Deno.env.get("PUBLIC_APP_URL") ||
    Deno.env.get("APP_URL") ||
    "https://app.staging.thunderpro.co";
  return `${publicAppUrl}/invoice/payment/${invoice.payment_token || invoice.id}`;
}

function confirmationNotice(job: JobRow, companyName: string, timezone: string, payDepositUrl: string | null): JobNotice {
  return {
    companyName,
    clientName: job.client_name || "",
    clientEmail: job.client_email || "",
    clientPhone: job.client_phone || "",
    address: jobPropertyAddress({
      street: job.property_street,
      apt: job.property_apt,
      city: job.property_city,
      state: job.property_state,
      zip: job.property_zip,
    }),
    dateLabel: formatDateOnlyLong(job.scheduled_date, timezone),
    startTime: formatJobClock(job.start_time),
    endTime: formatJobClock(job.end_time),
    serviceType: jobServiceLabel(job.service_type),
    frequencyLabel: jobFrequencyLabel(job.job_type, job.recurring_frequency),
    depositRequired: !!job.deposit_required,
    depositAmount: job.deposit_amount,
    payDepositUrl,
    pdfUrl: null,
  };
}

async function claimJobConfirmation(
  supabase: ReturnType<typeof createClient>,
  jobId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("jobs")
    .update({ confirmation_notified_at: new Date().toISOString() })
    .eq("id", jobId)
    .is("confirmation_notified_at", null)
    .select("id")
    .maybeSingle();
  if (error) return true;
  return Boolean(data?.id);
}

async function releaseJobConfirmation(
  supabase: ReturnType<typeof createClient>,
  jobId: string,
): Promise<void> {
  await supabase.from("jobs").update({ confirmation_notified_at: null }).eq("id", jobId);
}

function wantsClientEmail(channel: ClientChannel | undefined): boolean {
  return channel !== "sms";
}

function wantsClientSms(channel: ClientChannel | undefined): boolean {
  return channel !== "email";
}

function normalizePhoneNumber(phone: string): string {
  const cleaned = phone.replace(/[^\d+]/g, "");
  if (cleaned.startsWith("+1")) return cleaned;
  const digits = cleaned.startsWith("+") ? cleaned.slice(1) : cleaned;
  return `+1${digits}`;
}

async function sendSms(toPhone: string, bodyText: string): Promise<void> {
  const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  const twilioPhone = Deno.env.get("TWILIO_PHONE_NUMBER");
  if (!accountSid || !authToken || !twilioPhone) {
    throw new Error("Missing Twilio credentials");
  }
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: "Basic " + btoa(`${accountSid}:${authToken}`),
    },
    body: new URLSearchParams({
      To: normalizePhoneNumber(toPhone),
      From: twilioPhone,
      Body: bodyText,
    }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error((err as { message?: string }).message || "Failed to send SMS");
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { jobId, previousStatus, newStatus, clientChannel } = await req.json() as StatusPayload;

    if (!jobId || !newStatus) {
      return new Response(JSON.stringify({ error: "jobId and newStatus are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const prev = previousStatus || "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    const { data: job, error: jobError } = await supabase
      .from("jobs")
      .select("*")
      .eq("id", jobId)
      .single();

    if (jobError || !job) {
      logJobMessage("status_email", {
        jobId,
        previousStatus: prev,
        newStatus,
        result: "skipped",
        reason: "job_not_found",
      });
      return new Response(JSON.stringify({ error: "Job not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const origin = jobOrigin(job);
    const base = {
      jobId,
      jobNumber: job.job_number,
      origin,
      estimateId: job.estimate_id ?? null,
      walkthroughId: job.walkthrough_id ?? null,
      previousStatus: prev,
      newStatus,
    };

    if (isAutoTemporalTransition(prev, newStatus)) {
      logJobMessage("status_email", { ...base, audience: "client", channel: "email", result: "skipped", reason: "auto_temporal_transition" });
      logJobMessage("status_email", { ...base, audience: "owner", channel: "email", result: "skipped", reason: "auto_temporal_transition" });
      return new Response(JSON.stringify({ success: true, skipped: "auto_temporal_transition", origin }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const row = job as JobRow;

    const { data: profile } = await supabase
      .from("profiles")
      .select("company_name, timezone, first_name, company_phone")
      .eq("user_id", row.user_id)
      .maybeSingle();

    const companyName = profile?.company_name || "Thunder Pro";
    const timezone = profile?.timezone || "America/New_York";

    const { data: authUser, error: authErr } = await supabase.auth.admin.getUserById(row.user_id);
    if (authErr || !authUser?.user?.email) {
      logJobMessage("status_email", { ...base, audience: "owner", channel: "email", result: "error", reason: "owner_email_not_found" });
      return new Response(JSON.stringify({ error: "Owner email not found" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ownerEmail = authUser.user.email;
    const sent: string[] = [];

    const confirmedStatus = isJobConfirmation(prev, newStatus)
      ? newStatus
      : isJobConfirmation(prev, String(row.status || ""))
        ? String(row.status)
        : "";
    if (confirmedStatus) {
      const claimed = await claimJobConfirmation(supabase, jobId);
      if (!claimed) {
        logJobMessage("status_email", { ...base, audience: "client", channel: "email", result: "skipped", reason: "confirmation_already_sent" });
        logJobMessage("status_email", { ...base, audience: "owner", channel: "email", result: "skipped", reason: "confirmation_already_sent" });
        return new Response(JSON.stringify({ success: true, skipped: "confirmation_already_sent", origin }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      try {
      const payDepositUrl = jobHasDeposit(row.deposit_required, row.deposit_amount)
        ? await resolveDepositPaymentLink(supabase, row.deposit_invoice_id)
        : null;
      const notice = confirmationNotice(row, companyName, timezone, payDepositUrl);
      const ownerFirst = personFirstName(profile?.first_name) || "there";
      const ownerMail = renderJobNoticeEmail("owner", ownerFirst, notice);
      await sendEmailViaSMTP(ownerEmail, ownerMail.subject, ownerMail.html, ownerEmail);
      sent.push("owner");
      logJobMessage("status_email", { ...base, audience: "owner", channel: "email", result: "sent", template: "job_confirmed" });

      if (profile?.company_phone) {
        try {
          await sendSms(profile.company_phone, ownerJobConfirmedSms(notice, ownerFirst));
          sent.push("owner-sms");
          logJobMessage("status_sms", { ...base, audience: "owner", channel: "sms", result: "sent", template: "job_confirmed" });
        } catch (smsError) {
          logJobMessage("status_sms", { ...base, audience: "owner", channel: "sms", result: "error", reason: (smsError as Error).message });
        }
      } else {
        logJobMessage("status_sms", { ...base, audience: "owner", channel: "sms", result: "skipped", reason: "no_owner_phone" });
      }

      if (!row.client_email) {
        logJobMessage("status_email", { ...base, audience: "client", channel: "email", result: "skipped", reason: "no_client_email" });
      } else if (!wantsClientEmail(clientChannel)) {
        logJobMessage("status_email", { ...base, audience: "client", channel: "email", result: "skipped", reason: "client_channel", clientChannel: clientChannel ?? null });
      } else {
        const clientMail = renderJobNoticeEmail("client", personFirstName(row.client_name) || "there", notice);
        await sendEmailViaSMTP(row.client_email, clientMail.subject, clientMail.html, ownerEmail);
        sent.push("client");
        logJobMessage("status_email", { ...base, audience: "client", channel: "email", result: "sent", template: "job_confirmed" });
      }

      if (!row.client_phone) {
        logJobMessage("status_sms", { ...base, audience: "client", channel: "sms", result: "skipped", reason: "no_client_phone" });
      } else if (!wantsClientSms(clientChannel)) {
        logJobMessage("status_sms", { ...base, audience: "client", channel: "sms", result: "skipped", reason: "client_channel", clientChannel: clientChannel ?? null });
      } else {
        try {
          await sendSms(row.client_phone, clientJobConfirmedSms(notice));
          sent.push("client-sms");
          logJobMessage("status_sms", { ...base, audience: "client", channel: "sms", result: "sent", template: "job_confirmed" });
        } catch (smsError) {
          logJobMessage("status_sms", { ...base, audience: "client", channel: "sms", result: "error", reason: (smsError as Error).message });
        }
      }

      // Publishing a draft already texts and emails employees from notify-job-employees.
      if (prev !== "draft") {
        const employeeIds = normalizeEmployeeIds(row.assigned_employees);
        if (employeeIds.length > 0) {
          const { data: employees } = await supabase
            .from("employees")
            .select("id, first_name, last_name, email, phone")
            .in("id", employeeIds);
          for (const employee of (employees || []) as EmployeeRow[]) {
            const employeeFirst = personFirstName(employee.first_name) || "there";
            if (employee.email) {
              const mail = renderJobNoticeEmail("employee", employeeFirst, notice);
              await sendEmailViaSMTP(employee.email, mail.subject, mail.html, ownerEmail);
              sent.push(`employee:${employee.id}`);
              logJobMessage("status_email", { ...base, audience: "employee", channel: "email", employeeId: employee.id, result: "sent", template: "job_assigned" });
            }
            if (employee.phone) {
              try {
                await sendSms(employee.phone, employeeJobAssignedSms(notice, employeeFirst));
                sent.push(`employee-sms:${employee.id}`);
                logJobMessage("status_sms", { ...base, audience: "employee", channel: "sms", employeeId: employee.id, result: "sent", template: "job_assigned" });
              } catch (smsError) {
                logJobMessage("status_sms", { ...base, audience: "employee", channel: "sms", employeeId: employee.id, result: "error", reason: (smsError as Error).message });
              }
            }
          }
        }
      }

      return new Response(JSON.stringify({ success: true, sent, origin, template: "job_confirmed" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
      } catch (confirmError) {
        await releaseJobConfirmation(supabase, jobId);
        throw confirmError;
      }
    }

    const ownerMail = buildOwnerEmail(row, companyName, prev, newStatus);
    await sendEmailViaSMTP(ownerEmail, ownerMail.subject, ownerMail.html, ownerEmail);
    sent.push("owner");
    logJobMessage("status_email", { ...base, audience: "owner", channel: "email", result: "sent" });

    if (!CLIENT_NOTIFY_STATUSES.has(newStatus)) {
      logJobMessage("status_email", { ...base, audience: "client", channel: "email", result: "skipped", reason: "status_not_notifiable" });
    } else if (!row.client_email) {
      logJobMessage("status_email", { ...base, audience: "client", channel: "email", result: "skipped", reason: "no_client_email" });
    } else if (!shouldSendClientEmail(clientChannel)) {
      logJobMessage("status_email", { ...base, audience: "client", channel: "email", result: "skipped", reason: "client_channel", clientChannel: clientChannel ?? null });
    } else {
      const paymentLink = newStatus === "completed"
        ? await resolveInvoicePaymentLink(supabase, row.invoice_ids)
        : null;
      const clientMail = buildClientEmail(row, companyName, newStatus, prev, timezone, paymentLink);
      if (clientMail) {
        await sendEmailViaSMTP(row.client_email, clientMail.subject, clientMail.html, ownerEmail);
        sent.push("client");
        logJobMessage("status_email", { ...base, audience: "client", channel: "email", result: "sent" });
      } else {
        logJobMessage("status_email", { ...base, audience: "client", channel: "email", result: "skipped", reason: "no_template" });
      }
    }

    if (EMPLOYEE_NOTIFY_STATUSES.has(newStatus)) {
      const employeeIds = normalizeEmployeeIds(row.assigned_employees);
      if (employeeIds.length > 0) {
        const { data: employees } = await supabase
          .from("employees")
          .select("id, first_name, last_name, email")
          .in("id", employeeIds);

        for (const employee of (employees || []) as EmployeeRow[]) {
          if (!employee.email) continue;
          const mail = buildEmployeeEmail(row, employee, companyName, newStatus, timezone);
          await sendEmailViaSMTP(employee.email, mail.subject, mail.html, ownerEmail);
          sent.push(`employee:${employee.id}`);
          logJobMessage("status_email", { ...base, audience: "employee", channel: "email", employeeId: employee.id, result: "sent" });
        }
      }
    }

    return new Response(JSON.stringify({ success: true, sent, origin }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    logJobMessage("status_email", { result: "error", reason: (err as Error).message });
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
