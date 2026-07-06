import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Payload matches the DB trigger (row_to_json(NEW)) and the resend endpoint.
interface WebhookPayload {
  type?: string;
  table?: string;
  record: {
    id: string;
    first_name: string;
    last_name: string;
    email: string | null;
    user_id: string;
  };
}

function buildWelcomeEmail(firstName: string, companyName: string, downloadUrl: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:20px;font-family:Arial,sans-serif;background:#f9fafb;">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:10px;overflow:hidden;border:1px solid #e5e7eb;">
    <div style="text-align:center;padding:20px;background:#1e3a8a;color:#fff;">
      <h1 style="margin:0;font-size:22px;">${companyName}</h1>
      <p style="margin:5px 0 0;">Welcome to the team</p>
    </div>
    <div style="padding:24px;color:#111827;line-height:1.6;">
      <p style="font-size:16px;">Hi ${firstName},</p>
      <p>You've been added to the <strong>${companyName}</strong> team on Thunder Pro.</p>
      <p>Download the Thunder Pro employee app to see your schedule, clock in/out, and manage your shifts:</p>
      <div style="text-align:center;margin:28px 0;">
        <a href="${downloadUrl}" style="display:inline-block;background:#EB6A2A;color:#fff;padding:14px 28px;text-decoration:none;border-radius:6px;font-weight:bold;">Download the App</a>
      </div>
      <p style="font-size:14px;color:#6b7280;">When you open the app, sign in with the phone number your employer registered for you. No password needed — you'll get a one-time code by SMS.</p>
    </div>
    <div style="padding:14px 20px;background:#f3f4f6;color:#6b7280;font-size:12px;text-align:center;">
      © ${new Date().getFullYear()} ${companyName} · Powered by Thunder Pro
    </div>
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

    const readResponse = async (connection: Deno.TcpConn | Deno.TlsConn): Promise<string> => {
      const buffer = new Uint8Array(4096);
      const n = await connection.read(buffer);
      return decoder.decode(buffer.subarray(0, n || 0));
    };

    const sendCommand = async (connection: Deno.TcpConn | Deno.TlsConn, command: string): Promise<string> => {
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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const payload: WebhookPayload = await req.json();
    const employee = payload.record;

    if (!employee?.id) {
      return new Response(JSON.stringify({ error: "Missing employee record" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Skip silently if the employee has no email — the SMS invitation still goes out.
    if (!employee.email) {
      console.log(`Employee ${employee.id} has no email; skipping welcome email.`);
      return new Response(JSON.stringify({ success: true, skipped: "no_email" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: profile } = await supabase
      .from("profiles")
      .select("company_name")
      .eq("user_id", employee.user_id)
      .maybeSingle();

    const companyName = profile?.company_name || "Thunder Pro";
    const downloadUrl = Deno.env.get("EMPLOYEE_APP_DOWNLOAD_URL") || "https://app.staging.thunderpro.co/employee/login";

    const html = buildWelcomeEmail(employee.first_name, companyName, downloadUrl);
    await sendEmailViaSMTP(employee.email, `Welcome to the ${companyName} team`, html);

    console.log(`Welcome email sent to ${employee.email}`);

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Error in send-employee-welcome-email:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
