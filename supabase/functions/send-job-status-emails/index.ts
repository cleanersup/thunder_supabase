import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface StatusPayload {
  jobId: string;
  previousStatus: string;
  newStatus: string;
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
};

async function sendEmailViaSMTP(toEmail: string, subject: string, htmlContent: string): Promise<void> {
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

function formatAddress(job: JobRow): string {
  const apt = job.property_apt ? ` ${job.property_apt}` : "";
  const cityStateZip = [job.property_city, job.property_state, job.property_zip].filter(Boolean).join(", ");
  return [job.property_street ? `${job.property_street}${apt}` : "", cityStateZip].filter(Boolean).join(" • ");
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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { jobId, previousStatus, newStatus } = await req.json() as StatusPayload;

    if (!jobId || !newStatus) {
      return new Response(JSON.stringify({ error: "jobId and newStatus are required" }), {
        status: 400,
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
      .select("company_name")
      .eq("user_id", row.user_id)
      .maybeSingle();

    const companyName = profile?.company_name || "Thunder Pro";

    const { data: authUser, error: authErr } = await supabase.auth.admin.getUserById(row.user_id);
    if (authErr || !authUser?.user?.email) {
      return new Response(JSON.stringify({ error: "Owner email not found" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ownerEmail = authUser.user.email;
    const clientEmail = row.client_email || "";
    const clientName = row.client_name || "Client";

    const details = `
      <p><strong>Job:</strong> ${row.job_number || row.id}</p>
      <p><strong>Status:</strong> ${titleCaseStatus(previousStatus)} -> ${titleCaseStatus(newStatus)}</p>
      <p><strong>Service:</strong> ${row.service_type}</p>
      <p><strong>Date:</strong> ${row.scheduled_date}</p>
      <p><strong>Time:</strong> ${row.start_time || "N/A"}${row.end_time ? ` - ${row.end_time}` : ""}</p>
      <p><strong>Property:</strong> ${formatAddress(row) || "N/A"}</p>
      <p><strong>Total:</strong> $${(row.total_amount ?? 0).toFixed(2)} | <strong>Balance Due:</strong> $${(row.balance_due ?? 0).toFixed(2)}</p>
    `;

    const ownerSubject = `Job ${row.job_number || ""} status ${titleCaseStatus(newStatus)} — ${companyName}`.trim();
    const ownerBody = wrapEmail(
      "Job status updated",
      `<p>The job for <strong>${clientName}</strong> changed from <strong>${titleCaseStatus(previousStatus)}</strong> to <strong>${titleCaseStatus(newStatus)}</strong>.</p>${details}`
    );

    await sendEmailViaSMTP(ownerEmail, ownerSubject, ownerBody);

    if (clientEmail) {
      const clientSubject = `Update on your job with ${companyName}`;
      const clientBody = wrapEmail(
        "Your job status changed",
        `<p>Hi ${clientName},</p><p>Your job status changed to <strong>${titleCaseStatus(newStatus)}</strong>.</p>${details}`
      );
      await sendEmailViaSMTP(clientEmail, clientSubject, clientBody);
    }

    return new Response(JSON.stringify({ success: true }), {
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
