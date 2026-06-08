import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import * as Sentry from "npm:@sentry/deno";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Sentry.init({
  dsn: "https://ce035a76b6157a602d88c53eab6570e4@o4509804047958016.ingest.us.sentry.io/4510552540971008",
  environment: Deno.env.get("SUPABASE_URL")?.includes("staging") ? "staging" : "production",
  tracesSampleRate: 0.1,
});

type JobRow = {
  id: string;
  job_number: string | null;
  user_id: string;
  service_type: string;
  scheduled_date: string;
  start_time: string | null;
  end_time: string | null;
  client_name: string | null;
  client_email: string | null;
  property_street: string | null;
  property_apt: string | null;
  property_city: string | null;
  property_state: string | null;
  property_zip: string | null;
  assigned_employees: string[] | unknown;
  status: string;
};

type EmployeeRow = {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
};

type ReminderType = "reminder_24h" | "reminder_day_of";

function normalizeEmployeeIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => (typeof item === "string" ? item : (item as { id?: string })?.id))
    .filter((id): id is string => typeof id === "string" && id.length > 0);
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

async function sendEmailViaSMTP(toEmail: string, subject: string, htmlContent: string): Promise<void> {
  const smtpHost = "email-smtp.us-east-2.amazonaws.com";
  const smtpPort = 587;
  const smtpUser = Deno.env.get("AWS_SES_SMTP_USERNAME") || "";
  const smtpPass = Deno.env.get("AWS_SES_SMTP_PASSWORD") || "";
  const fromEmail = '"Thunder Pro" <info@thunderpro.co>';

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
      if (tlsConn) tlsConn.close();
      if (conn) conn.close();
    } catch { /* ignore */ }
    throw error;
  }
}

function buildEmployeeReminderEmail(
  job: JobRow,
  employee: EmployeeRow,
  companyName: string,
  reminderType: ReminderType,
  timezone: string,
): { subject: string; html: string } {
  const schedule = `${formatDate(job.scheduled_date, timezone)} a las ${formatTime(job.start_time)}`;
  const address = formatAddress(job) || "N/A";
  const clientName = job.client_name || "Cliente";
  const employeeName = `${employee.first_name} ${employee.last_name}`.trim();
  const whenLabel = reminderType === "reminder_24h" ? "mañana" : "hoy";

  return {
    subject: `Recordatorio de trabajo — ${whenLabel} — ${job.job_number || companyName}`,
    html: wrapEmail(
      `Recordatorio de trabajo (${whenLabel})`,
      `<p>Hi ${employeeName},</p>
      <p>Tienes un trabajo asignado para <strong>${whenLabel}</strong>:</p>
      <p><strong>Cliente:</strong> ${clientName}</p>
      <p><strong>Fecha/Hora:</strong> ${schedule}</p>
      <p><strong>Dirección:</strong> ${address}</p>
      <p><strong>Servicio:</strong> ${job.service_type}</p>`,
    ),
  };
}

function buildClientReminderEmail(
  job: JobRow,
  companyName: string,
  reminderType: ReminderType,
  timezone: string,
): { subject: string; html: string } {
  const clientName = job.client_name || "Cliente";
  const schedule = `${formatDate(job.scheduled_date, timezone)} a las ${formatTime(job.start_time)}`;
  const address = formatAddress(job) || "N/A";
  const whenLabel = reminderType === "reminder_24h" ? "mañana" : "hoy";

  return {
    subject: `Recordatorio: tu trabajo es ${whenLabel} — ${companyName}`,
    html: wrapEmail(
      `Recordatorio de trabajo (${whenLabel})`,
      `<p>Hola ${clientName},</p>
      <p>Te recordamos que tu servicio con <strong>${companyName}</strong> está programado para <strong>${whenLabel}</strong>.</p>
      <p><strong>Fecha y hora:</strong> ${schedule}</p>
      <p><strong>Dirección:</strong> ${address}</p>
      <p>¡Te esperamos!</p>`,
    ),
  };
}

async function processJobReminder(
  supabase: ReturnType<typeof createClient>,
  job: JobRow,
  reminderType: ReminderType,
  timezone: string,
  companyName: string,
): Promise<boolean> {
  const { data: alreadySent } = await supabase
    .from("job_notifications_sent")
    .select("id")
    .eq("job_id", job.id)
    .eq("type", reminderType)
    .maybeSingle();

  if (alreadySent) return false;

  const employeeIds = normalizeEmployeeIds(job.assigned_employees);
  if (employeeIds.length > 0) {
    const { data: employees } = await supabase
      .from("employees")
      .select("id, first_name, last_name, email")
      .in("id", employeeIds);

    for (const employee of (employees || []) as EmployeeRow[]) {
      if (!employee.email) continue;
      const mail = buildEmployeeReminderEmail(job, employee, companyName, reminderType, timezone);
      await sendEmailViaSMTP(employee.email, mail.subject, mail.html);
    }
  }

  if (job.client_email) {
    const clientMail = buildClientReminderEmail(job, companyName, reminderType, timezone);
    await sendEmailViaSMTP(job.client_email, clientMail.subject, clientMail.html);
  }

  await supabase.from("job_notifications_sent").insert({
    job_id: job.id,
    type: reminderType,
  });

  return true;
}

const handler = async (req: Request): Promise<Response> => {
  return await Sentry.withScope(async () => {
    Sentry.setTag("function", "send-job-reminders");

    if (req.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      );

      const today = new Date();
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const todayDate = today.toISOString().split("T")[0];
      const tomorrowDate = tomorrow.toISOString().split("T")[0];

      let sentCount = 0;

      const { data: jobs24h, error: err24h } = await supabase
        .from("jobs")
        .select("*")
        .eq("status", "upcoming")
        .eq("scheduled_date", tomorrowDate);

      if (err24h) throw err24h;

      for (const job of (jobs24h || []) as JobRow[]) {
        try {
          const { data: profile } = await supabase
            .from("profiles")
            .select("company_name, timezone")
            .eq("user_id", job.user_id)
            .maybeSingle();

          const sent = await processJobReminder(
            supabase,
            job,
            "reminder_24h",
            profile?.timezone || "America/New_York",
            profile?.company_name || "Thunder Pro",
          );
          if (sent) sentCount++;
        } catch (e) {
          console.error(`Failed 24h reminder for job ${job.id}:`, e);
        }
      }

      const { data: jobsToday, error: errToday } = await supabase
        .from("jobs")
        .select("*")
        .eq("status", "today")
        .eq("scheduled_date", todayDate);

      if (errToday) throw errToday;

      for (const job of (jobsToday || []) as JobRow[]) {
        try {
          const { data: profile } = await supabase
            .from("profiles")
            .select("company_name, timezone")
            .eq("user_id", job.user_id)
            .maybeSingle();

          const sent = await processJobReminder(
            supabase,
            job,
            "reminder_day_of",
            profile?.timezone || "America/New_York",
            profile?.company_name || "Thunder Pro",
          );
          if (sent) sentCount++;
        } catch (e) {
          console.error(`Failed day-of reminder for job ${job.id}:`, e);
        }
      }

      return new Response(JSON.stringify({ success: true, sent: sentCount }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (error: unknown) {
      Sentry.captureException(error);
      return new Response(JSON.stringify({ error: (error as Error).message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  });
};

serve(handler);
