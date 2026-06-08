import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

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
};

type EmployeeRow = {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
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
  if (!timeStr) return "Por confirmar";
  const [hours, minutes] = timeStr.split(":");
  const hour = parseInt(hours, 10);
  const ampm = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${minutes} ${ampm}`;
}

function formatDate(dateStr: string, timezone = "America/New_York"): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const dateAtMidday = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  return new Intl.DateTimeFormat("es-US", {
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
  return `${date} a las ${start}${end}`;
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
  const clientName = job.client_name || "Cliente";
  const schedule = formatSchedule(job, timezone);
  const address = formatAddress(job) || "N/A";

  if (newStatus === "completed") {
    const invoiceBlock = paymentLink
      ? `<p style="margin-top:20px;"><a href="${paymentLink}" style="display:inline-block;background:#1e3a8a;color:#fff;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:bold;">Ver factura y pagar</a></p>`
      : "";
    return {
      subject: `Tu trabajo ha sido completado — ${companyName}`,
      html: wrapEmail(
        "Trabajo completado",
        `<p>Hola ${clientName},</p>
        <p><strong>Tu trabajo ha sido completado.</strong></p>
        <p>Gracias por confiar en ${companyName}. Esperamos que todo haya quedado a tu satisfacción.</p>
        ${invoiceBlock}`,
      ),
    };
  }

  if (newStatus === "cancelled") {
    return {
      subject: `Tu trabajo ha sido cancelado — ${companyName}`,
      html: wrapEmail(
        "Trabajo cancelado",
        `<p>Hola ${clientName},</p>
        <p>Tu trabajo programado para <strong>${schedule}</strong> ha sido <strong>cancelado</strong>.</p>
        <p><strong>Dirección:</strong> ${address}</p>
        <p>Si tienes preguntas, contáctanos directamente.</p>`,
      ),
    };
  }

  if (newStatus === "upcoming") {
    const isReschedule = ["upcoming", "today", "ongoing", "missed"].includes(previousStatus);
    const title = isReschedule ? "Trabajo reagendado" : "Trabajo confirmado";
    const intro = isReschedule
      ? `<p>Hola ${clientName},</p><p>Tu trabajo ha sido <strong>reagendado</strong>.</p>`
      : `<p>Hola ${clientName},</p><p>Tu trabajo ha sido <strong>confirmado</strong>.</p>`;

    return {
      subject: isReschedule
        ? `Tu trabajo ha sido reagendado — ${companyName}`
        : `Tu trabajo ha sido confirmado — ${companyName}`,
      html: wrapEmail(
        title,
        `${intro}
        <p><strong>Fecha y hora:</strong> ${schedule}</p>
        <p><strong>Dirección:</strong> ${address}</p>
        <p>Te esperamos. Si necesitas hacer algún cambio, contáctanos.</p>`,
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
  const clientName = job.client_name || "Cliente";
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
    if (isAutoTemporalTransition(prev, newStatus)) {
      return new Response(JSON.stringify({ success: true, skipped: "auto_temporal_transition" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    const { data: job, error: jobError } = await supabase
      .from("jobs")
      .select("*")
      .eq("id", jobId)
      .single();

    if (jobError || !job) {
      return new Response(JSON.stringify({ error: "Job not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const row = job as JobRow;

    const { data: profile } = await supabase
      .from("profiles")
      .select("company_name, timezone")
      .eq("user_id", row.user_id)
      .maybeSingle();

    const companyName = profile?.company_name || "Thunder Pro";
    const timezone = profile?.timezone || "America/New_York";

    const { data: authUser, error: authErr } = await supabase.auth.admin.getUserById(row.user_id);
    if (authErr || !authUser?.user?.email) {
      return new Response(JSON.stringify({ error: "Owner email not found" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ownerEmail = authUser.user.email;
    const sent: string[] = [];

    const ownerMail = buildOwnerEmail(row, companyName, prev, newStatus);
    await sendEmailViaSMTP(ownerEmail, ownerMail.subject, ownerMail.html, ownerEmail);
    sent.push("owner");

    if (CLIENT_NOTIFY_STATUSES.has(newStatus) && row.client_email && shouldSendClientEmail(clientChannel)) {
      const paymentLink = newStatus === "completed"
        ? await resolveInvoicePaymentLink(supabase, row.invoice_ids)
        : null;
      const clientMail = buildClientEmail(row, companyName, newStatus, prev, timezone, paymentLink);
      if (clientMail) {
        await sendEmailViaSMTP(row.client_email, clientMail.subject, clientMail.html, ownerEmail);
        sent.push("client");
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
        }
      }
    }

    return new Response(JSON.stringify({ success: true, sent }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
