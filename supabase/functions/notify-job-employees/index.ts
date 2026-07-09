import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendPushToEmployees, type PushMessage } from "../_shared/fcm.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type EventType = "assigned" | "rescheduled" | "cancelled";

interface NotifyRequest {
  jobId: string;
  eventType: EventType;
}

interface JobRow {
  id: string;
  job_number: string | null;
  user_id: string;
  service_type: string;
  scheduled_date: string;
  start_time: string | null;
  client_name: string | null;
  property_street: string | null;
  property_apt: string | null;
  property_city: string | null;
  property_state: string | null;
  property_zip: string | null;
  assigned_employees: unknown;
}

interface EmployeeRow {
  id: string;
  phone: string | null;
  email: string | null;
  first_name: string;
  last_name: string;
}

function normalizeEmployeeIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => (typeof item === "string" ? item : (item as { id?: string })?.id))
    .filter((id): id is string => typeof id === "string" && id.length > 0);
}

function formatTime(timeStr: string | null): string {
  if (!timeStr) return "";
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
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: timezone,
  }).format(dateAtMidday);
}

function formatAddress(job: JobRow): string {
  const apt = job.property_apt ? ` ${job.property_apt}` : "";
  const cityStateZip = [job.property_city, job.property_state, job.property_zip].filter(Boolean).join(", ");
  return [job.property_street ? `${job.property_street}${apt}` : "", cityStateZip].filter(Boolean).join(", ");
}

function buildMessage(job: JobRow, eventType: EventType, timezone: string): PushMessage {
  const when = `${formatDate(job.scheduled_date, timezone)}${job.start_time ? ` at ${formatTime(job.start_time)}` : ""}`;
  const jobLabel = job.job_number ? `Job ${job.job_number}` : "A job";
  const client = job.client_name ? ` for ${job.client_name}` : "";

  const data: Record<string, string> = {
    type: `job_${eventType}`,
    job_id: job.id,
  };

  switch (eventType) {
    case "assigned":
      return {
        title: "New job assigned",
        body: `${jobLabel}${client} on ${when}.`,
        data,
      };
    case "rescheduled":
      return {
        title: "Job rescheduled",
        body: `${jobLabel}${client} is now ${when}.`,
        data,
      };
    case "cancelled":
      return {
        title: "Job cancelled",
        body: `${jobLabel}${client} on ${when} was cancelled.`,
        data,
      };
  }
}

function buildSmsFallback(job: JobRow, eventType: EventType, timezone: string, companyName: string): string {
  const when = `${formatDate(job.scheduled_date, timezone)}${job.start_time ? ` at ${formatTime(job.start_time)}` : ""}`;
  const jobLabel = job.job_number ? `job ${job.job_number}` : "a job";
  const address = formatAddress(job);
  const addrSuffix = address ? ` Address: ${address}` : "";

  switch (eventType) {
    case "assigned":
      return `${companyName}: You've been assigned ${jobLabel} on ${when}.${addrSuffix}`;
    case "rescheduled":
      return `${companyName}: ${jobLabel} has been rescheduled to ${when}.${addrSuffix}`;
    case "cancelled":
      return `${companyName}: ${jobLabel} on ${when} has been cancelled.`;
  }
}

function wrapEmail(title: string, body: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:20px;font-family:Arial,sans-serif;background:#f9fafb;">
  <div style="max-width:640px;margin:0 auto;background:#fff;border-radius:10px;overflow:hidden;border:1px solid #e5e7eb;">
    <div style="padding:16px 20px;background:#1e3a8a;color:#fff;"><h2 style="margin:0;font-size:20px;">${title}</h2></div>
    <div style="padding:20px;color:#111827;line-height:1.6;">${body}</div>
    <div style="padding:12px 20px;background:#f3f4f6;color:#6b7280;font-size:12px;">Thunder Pro automatic notification</div>
  </div>
</body>
</html>`;
}

function buildEmployeeEmail(
  job: JobRow,
  employee: EmployeeRow,
  eventType: EventType,
  timezone: string,
  companyName: string,
): { subject: string; html: string } {
  const employeeName = `${employee.first_name} ${employee.last_name}`.trim();
  const clientName = job.client_name || "Client";
  const when = `${formatDate(job.scheduled_date, timezone)}${job.start_time ? ` at ${formatTime(job.start_time)}` : ""}`;
  const address = formatAddress(job) || "N/A";
  const jobLabel = job.job_number ? `Job ${job.job_number}` : "A job";

  if (eventType === "cancelled") {
    return {
      subject: `Job cancelled — ${job.job_number || companyName}`,
      html: wrapEmail(
        "Job cancelled",
        `<p>Hi ${employeeName},</p>
        <p>The following assigned job has been <strong>cancelled</strong>:</p>
        <p><strong>Job:</strong> ${jobLabel}</p>
        <p><strong>Client:</strong> ${clientName}</p>
        <p><strong>Date/Time:</strong> ${when}</p>
        <p><strong>Address:</strong> ${address}</p>`,
      ),
    };
  }

  if (eventType === "rescheduled") {
    return {
      subject: `Job rescheduled — ${job.job_number || companyName}`,
      html: wrapEmail(
        "Job rescheduled",
        `<p>Hi ${employeeName},</p>
        <p>Your assigned job has been <strong>rescheduled</strong>:</p>
        <p><strong>Job:</strong> ${jobLabel}</p>
        <p><strong>Client:</strong> ${clientName}</p>
        <p><strong>New date/time:</strong> ${when}</p>
        <p><strong>Address:</strong> ${address}</p>
        <p><strong>Service:</strong> ${job.service_type}</p>`,
      ),
    };
  }

  return {
    subject: `Job assigned — ${job.job_number || companyName}`,
    html: wrapEmail(
      "Job assignment",
      `<p>Hi ${employeeName},</p>
      <p>You have been assigned to a job:</p>
      <p><strong>Job:</strong> ${jobLabel}</p>
      <p><strong>Client:</strong> ${clientName}</p>
      <p><strong>Date/Time:</strong> ${when}</p>
      <p><strong>Address:</strong> ${address}</p>
      <p><strong>Service:</strong> ${job.service_type}</p>`,
    ),
  };
}

async function sendEmailViaSMTP(toEmail: string, subject: string, htmlContent: string): Promise<void> {
  const smtpHost = "email-smtp.us-east-2.amazonaws.com";
  const smtpPort = 587;
  const smtpUser = Deno.env.get("AWS_SES_SMTP_USERNAME") || "";
  const smtpPass = Deno.env.get("AWS_SES_SMTP_PASSWORD") || "";
  const fromEmail = Deno.env.get("AWS_SES_FROM_EMAIL") || '"Thunder Pro" <info@thunderpro.co>';

  if (!smtpUser || !smtpPass) throw new Error("AWS SES SMTP credentials are missing.");

  let conn: Deno.TcpConn | null = null;
  let tlsConn: Deno.TlsConn | null = null;

  try {
    conn = await Deno.connect({ hostname: smtpHost, port: smtpPort });
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const readResponse = async (connection: Deno.TcpConn | Deno.TlsConn) => {
      const buffer = new Uint8Array(4096);
      const n = await connection.read(buffer);
      return decoder.decode(buffer.subarray(0, n || 0));
    };

    const sendCommand = async (connection: Deno.TcpConn | Deno.TlsConn, command: string) => {
      await connection.write(encoder.encode(command + "\r\n"));
      const response = await readResponse(connection);
      const code = response.substring(0, 3);
      if (code.startsWith("4") || code.startsWith("5")) {
        throw new Error(`SMTP Error ${code}: ${response.trim()}`);
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

    const headers = [
      `From: ${fromEmail}`,
      `To: ${toEmail}`,
      `Subject: ${subject}`,
      "MIME-Version: 1.0",
      "Content-Type: text/html; charset=UTF-8",
      "",
    ].join("\r\n");

    await tlsConn.write(encoder.encode(headers + "\r\n"));
    const bytes = encoder.encode(htmlContent);
    for (let i = 0; i < bytes.length; i += 4096) {
      await tlsConn.write(bytes.slice(i, Math.min(i + 4096, bytes.length)));
    }
    await tlsConn.write(encoder.encode("\r\n.\r\n"));
    await readResponse(tlsConn);
    await sendCommand(tlsConn, "QUIT");
    tlsConn.close();
  } catch (error) {
    try {
      tlsConn?.close();
    } catch { /* ignore */ }
    try {
      conn?.close();
    } catch { /* ignore */ }
    throw error;
  }
}

const normalizePhoneNumber = (phone: string): string => {
  const cleaned = phone.replace(/[^\d+]/g, "");
  if (cleaned.startsWith("+1")) return cleaned;
  const digits = cleaned.startsWith("+") ? cleaned.slice(1) : cleaned;
  return `+1${digits}`;
};

async function sendSms(toPhone: string, bodyText: string): Promise<void> {
  const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  const twilioPhone = Deno.env.get("TWILIO_PHONE_NUMBER");
  if (!accountSid || !authToken || !twilioPhone) {
    throw new Error("Missing Twilio credentials");
  }
  const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const resp = await fetch(twilioUrl, {
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
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.message || "Failed to send SMS");
  }
}

function notificationType(eventType: EventType): string {
  return `job_${eventType}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { jobId, eventType }: NotifyRequest = await req.json();

    if (!jobId || !eventType) {
      return new Response(JSON.stringify({ error: "jobId and eventType are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!["assigned", "rescheduled", "cancelled"].includes(eventType)) {
      return new Response(JSON.stringify({ error: "Invalid eventType" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: job, error: jobError } = await supabase
      .from("jobs")
      .select("*")
      .eq("id", jobId)
      .maybeSingle();

    if (jobError || !job) {
      return new Response(JSON.stringify({ error: "Job not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const row = job as JobRow;
    const employeeIds = normalizeEmployeeIds(row.assigned_employees);

    if (employeeIds.length === 0) {
      return new Response(JSON.stringify({ success: true, skipped: "no_assigned_employees" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("company_name, timezone")
      .eq("user_id", row.user_id)
      .maybeSingle();

    const companyName = profile?.company_name || "Thunder Pro";
    const timezone = profile?.timezone || "America/New_York";

    const pushMessage = buildMessage(row, eventType, timezone);
    const smsBody = buildSmsFallback(row, eventType, timezone, companyName);
    const notifType = notificationType(eventType);

    const { data: employees } = await supabase
      .from("employees")
      .select("id, phone, email, first_name, last_name")
      .in("id", employeeIds);

    const employeeList = (employees ?? []) as EmployeeRow[];

    // 1) Push to assigned employees who have an active device token (best-effort).
    let pushed = 0;
    try {
      const pushResult = await sendPushToEmployees(supabase, employeeIds, pushMessage);
      pushed = pushResult.notifiedEmployeeIds.length;
    } catch (e) {
      console.error("Push failed:", e);
    }

    // 2) SMS + email + in-app notification per assigned employee (parallel, best-effort).
    const deliveryResults = await Promise.all(employeeList.map(async (emp) => {
      let sms = false;
      let email = false;
      let inApp = false;

      if (emp.phone) {
        try {
          await sendSms(emp.phone, smsBody);
          sms = true;
        } catch (e) {
          console.error(`SMS failed for employee ${emp.id}:`, e);
        }
      }

      if (emp.email) {
        const mail = buildEmployeeEmail(row, emp, eventType, timezone, companyName);
        try {
          await sendEmailViaSMTP(emp.email, mail.subject, mail.html);
          email = true;
        } catch (e) {
          console.error(`Email failed for employee ${emp.id}:`, e);
        }
      }

      const { error: insertError } = await supabase
        .from("notifications")
        .insert({
          user_id: row.user_id,
          employee_id: emp.id,
          type: notifType,
          title: pushMessage.title,
          message: pushMessage.body,
          related_id: row.id,
          related_type: "job",
          read: false,
        });

      if (insertError) {
        console.error(`In-app notification failed for employee ${emp.id}:`, insertError);
      } else {
        inApp = true;
      }

      return { sms, email, inApp };
    }));

    const smsSent = deliveryResults.filter((r) => r.sms).length;
    const emailsSent = deliveryResults.filter((r) => r.email).length;
    const inAppCreated = deliveryResults.filter((r) => r.inApp).length;

    return new Response(
      JSON.stringify({
        success: true,
        event_type: eventType,
        pushed,
        sms_sent: smsSent,
        emails_sent: emailsSent,
        in_app_created: inAppCreated,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Error in notify-job-employees:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
