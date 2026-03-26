import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.76.1";
import * as Sentry from "npm:@sentry/deno";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Sentry.init({
  dsn: "https://ce035a76b6157a602d88c53eab6570e4@o4509804047958016.ingest.us.sentry.io/4510552540971008",
  environment: Deno.env.get("SUPABASE_URL")?.includes("staging") ? "staging" : "production",
  tracesSampleRate: 0.1,
});

function formatMoney(n: number): string {
  return (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(d: string | null | undefined): string {
  if (!d) return "N/A";
  try {
    return new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  } catch {
    return String(d);
  }
}

/** Same layout as send-estimate-email residential client template (header, sections, Download PDF, footer). */
function generateContractClientEmailHtml(
  contract: Record<string, unknown>,
  companyName: string,
  publicSupabaseUrl: string,
): string {
  const token = contract.public_share_token || contract.id;
  const pdfUrl = `${publicSupabaseUrl}/functions/v1/download-contract-pdf?token=${token}`;
  const total = formatMoney(Number(contract.total));
  const start = formatDate(contract.start_date as string | null);
  const end = formatDate(contract.end_date as string | null);

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:20px;font-family:Arial,sans-serif">
<div style="max-width:600px;margin:0 auto">
<div style="text-align:center;padding:15px;background:#1e3a8a;color:white">
<h1 style="margin:0;font-size:22px">${escapeHtml(companyName)}</h1>
<p style="margin:5px 0">Service Agreement</p>
</div>
<div style="padding:15px">
<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Client Information</h3>
<div style="border-top:1px solid #1e3a8a;margin-bottom:12px"></div>
<p><strong>Name:</strong> ${escapeHtml(String(contract.recipient_name || ""))}<br>
<strong>Email:</strong> ${escapeHtml(String(contract.recipient_email || ""))}<br>
<strong>Phone:</strong> ${escapeHtml(String(contract.recipient_phone || ""))}<br>
<strong>Address:</strong> ${escapeHtml(String(contract.recipient_address || ""))}</p>

<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Contract Details</h3>
<div style="border-top:1px solid #1e3a8a;margin-bottom:12px"></div>
<p><strong>Contract #:</strong> ${escapeHtml(String(contract.contract_number || ""))}<br>
<strong>Period:</strong> ${escapeHtml(start)} — ${escapeHtml(end)}<br>
<strong>Payment frequency:</strong> ${escapeHtml(String(contract.payment_frequency || "—"))}</p>

<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Contract Value</h3>
<table cellpadding="0" cellspacing="0" style="width:100%;background-color:#f0fdf4">
  <tr>
    <td style="padding:16px">
      <table cellpadding="0" cellspacing="0" style="width:100%">
        <tr>
          <td style="padding:12px 0 0 0;text-align:left;font-weight:bold;font-size:20px;color:#1e3a8a;border-top:1px solid #d1d5db">Total:</td>
          <td style="padding:12px 0 0 0;text-align:right;font-weight:bold;font-size:20px;color:#1e3a8a;border-top:1px solid #d1d5db">$${total}</td>
        </tr>
      </table>
    </td>
  </tr>
</table>

<div style="text-align:center;margin:30px 0">
<a href="${pdfUrl}" style="display:inline-block;background:#1e3a8a;color:white;padding:15px 40px;text-decoration:none;border-radius:5px;font-weight:bold;margin:10px">Download PDF</a>
</div>
</div>
<div style="text-align:center;padding:15px;background:#1e3a8a;color:white">
<p style="margin:0 0 5px 0;font-size:12px">Service provided by</p>
<p style="margin:0">© 2024 Thunder Pro Inc. | <a href="https://www.thunderpro.co" style="color:white">www.thunderpro.co</a></p>
</div>
</div>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function sendEmailViaSMTP(toEmail: string, bccEmail: string | null, subject: string, htmlContent: string): Promise<void> {
  const smtpHost = "email-smtp.us-east-2.amazonaws.com";
  const smtpPort = 587;
  const smtpUser = Deno.env.get("AWS_SES_SMTP_USERNAME") || "";
  const smtpPass = Deno.env.get("AWS_SES_SMTP_PASSWORD") || "";
  const fromEmail = '"Thunder Pro" <info@thunderpro.co>';

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

    const sendCommand = async (connection: Deno.TcpConn | Deno.TlsConn, command: string, maskInLog = false): Promise<string> => {
      const displayCommand = maskInLog ? command.substring(0, 15) + "..." : command;
      console.log("SMTP:", displayCommand);
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
    await sendCommand(tlsConn, btoa(smtpUser), true);
    await sendCommand(tlsConn, btoa(smtpPass), true);
    await sendCommand(tlsConn, "MAIL FROM:<info@thunderpro.co>");
    await sendCommand(tlsConn, `RCPT TO:<${toEmail}>`);
    if (bccEmail && bccEmail !== toEmail) await sendCommand(tlsConn, `RCPT TO:<${bccEmail}>`);
    await sendCommand(tlsConn, "DATA");

    const timestamp = Date.now();
    const randomId = Math.random().toString(36).substring(2, 15);
    const messageId = `<${timestamp}.${randomId}@thunderpro.co>`;
    const headers = [
      `From: ${fromEmail}`,
      `To: ${toEmail}`,
      `Subject: ${subject}`,
      `Message-ID: ${messageId}`,
      "X-Mailer: ThunderPro-Contracts",
      "MIME-Version: 1.0",
      "Content-Type: text/html; charset=UTF-8",
      "",
    ].join("\r\n");

    await tlsConn.write(encoder.encode(headers + "\r\n"));
    const contentBytes = encoder.encode(htmlContent);
    const chunkSize = 4096;
    for (let i = 0; i < contentBytes.length; i += chunkSize) {
      await tlsConn.write(contentBytes.slice(i, Math.min(i + chunkSize, contentBytes.length)));
    }
    await tlsConn.write(encoder.encode("\r\n.\r\n"));
    await readResponse(tlsConn);
    await sendCommand(tlsConn, "QUIT");
    tlsConn.close();
  } catch (e: unknown) {
    try {
      if (tlsConn) tlsConn.close();
      if (conn) conn.close();
    } catch { /* ignore */ }
    throw new Error(`Failed to send email: ${e instanceof Error ? e.message : String(e)}`);
  }
}

serve(async (req: Request): Promise<Response> => {
  return await Sentry.withScope(async () => {
    Sentry.setTag("function", "send-contract-email");
    if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

    try {
      if (req.method !== "POST") {
        return new Response(JSON.stringify({ error: "Method not allowed" }), {
          status: 405,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }

      const authHeader = req.headers.get("Authorization");
      if (!authHeader) {
        return new Response(JSON.stringify({ error: "Authentication required" }), {
          status: 401,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }

      const { contractId, recipientEmail } = await req.json() as { contractId?: string; recipientEmail?: string };
      if (!contractId || !recipientEmail) {
        return new Response(JSON.stringify({ error: "contractId and recipientEmail required" }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }

      const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
      const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
      const token = authHeader.replace("Bearer ", "");
      const supabaseUser = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });

      const { data: { user }, error: authErr } = await supabaseUser.auth.getUser(token);
      if (authErr || !user?.id) {
        return new Response(JSON.stringify({ error: "Authentication required" }), {
          status: 401,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }

      const { data: contract, error: cErr } = await supabaseUser.from("contracts").select("*").eq("id", contractId).maybeSingle();
      if (cErr || !contract || contract.user_id !== user.id) {
        return new Response(JSON.stringify({ error: "Contract not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }

      const { data: profile } = await supabaseUser.from("profiles").select("company_name, company_email").eq("user_id", user.id).maybeSingle();
      const companyName = profile?.company_name || "Company Name";
      const publicSupabaseUrl = Deno.env.get("PUBLIC_APP_URL") || Deno.env.get("APP_URL") || "https://staging.thunderpro.co";

      const html = generateContractClientEmailHtml(contract as Record<string, unknown>, companyName, publicSupabaseUrl);
      const subject = `Service Agreement - ${companyName}`;

      const ownerEmail = profile?.company_email || null;
      const bcc = ownerEmail && ownerEmail !== recipientEmail ? ownerEmail : null;
      await sendEmailViaSMTP(recipientEmail, bcc, subject, html);

      return new Response(JSON.stringify({ success: true, message: "Email sent" }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    } catch (e: unknown) {
      Sentry.captureException(e);
      const message = e instanceof Error ? e.message : String(e);
      return new Response(JSON.stringify({ error: message }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }
  });
});
