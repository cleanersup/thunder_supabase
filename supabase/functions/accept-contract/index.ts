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

function htmlPage(title: string, message: string, success: boolean): string {
  const iconBg = success
    ? "linear-gradient(135deg, #10b981 0%, #059669 100%)"
    : "#6b7280";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      background: linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .container {
      background: white;
      border-radius: 16px;
      padding: 48px 32px;
      max-width: 500px;
      width: 100%;
      text-align: center;
      box-shadow: 0 20px 60px rgba(0,0,0,0.2);
    }
    .icon {
      width: 80px;
      height: 80px;
      background: ${iconBg};
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 24px;
      font-size: 40px;
      color: white;
    }
    h1 { color: #1e3a8a; font-size: 26px; margin-bottom: 16px; }
    p { color: #555; font-size: 16px; line-height: 1.6; margin-bottom: 16px; }
    .footer {
      color: #999;
      font-size: 14px;
      margin-top: 24px;
      padding-top: 24px;
      border-top: 1px solid #e5e7eb;
    }
    .footer a { color: #3b82f6; text-decoration: none; font-weight: 600; }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">${success ? "✓" : "!"}</div>
    <h1>${title}</h1>
    <p>${message}</p>
    <div class="footer">
      <p>© 2024 Thunder Pro Inc.<br>
      <a href="https://www.thunderpro.co" target="_blank" rel="noopener">www.thunderpro.co</a></p>
    </div>
  </div>
</body>
</html>`;
}

async function sendEmailViaSMTP(
  toEmail: string,
  subject: string,
  htmlContent: string,
): Promise<void> {
  const smtpHost = "email-smtp.us-east-2.amazonaws.com";
  const smtpPort = 587;
  const smtpUser = Deno.env.get("AWS_SES_SMTP_USERNAME") || "";
  const smtpPass = Deno.env.get("AWS_SES_SMTP_PASSWORD") || "";

  let conn: Deno.TcpConn | null = null;
  let tlsConn: Deno.TlsConn | null = null;

  try {
    conn = await Deno.connect({ hostname: smtpHost, port: smtpPort });

    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const readResponse = async (c: Deno.TcpConn | Deno.TlsConn): Promise<string> => {
      const buf = new Uint8Array(4096);
      const n = await c.read(buf);
      return decoder.decode(buf.subarray(0, n || 0));
    };

    const sendCommand = async (
      c: Deno.TcpConn | Deno.TlsConn,
      cmd: string,
    ): Promise<string> => {
      await c.write(encoder.encode(cmd + "\r\n"));
      const res = await readResponse(c);
      const code = res.substring(0, 1);
      if (code === "4" || code === "5") throw new Error(`SMTP Error: ${res.trim()}`);
      return res;
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

    await sendCommand(tlsConn, `MAIL FROM:<info@thunderpro.co>`);
    await sendCommand(tlsConn, `RCPT TO:<${toEmail}>`);
    await sendCommand(tlsConn, "DATA");

    const msgId = `<${Date.now()}.${Math.random().toString(36).slice(2)}@thunderpro.co>`;
    const headers = [
      `From: "Thunder Pro" <info@thunderpro.co>`,
      `To: ${toEmail}`,
      `Subject: ${subject}`,
      `Message-ID: ${msgId}`,
      "MIME-Version: 1.0",
      "Content-Type: text/html; charset=UTF-8",
      "",
    ].join("\r\n");

    await tlsConn.write(encoder.encode(headers + "\r\n"));

    const body = encoder.encode(htmlContent);
    const chunkSize = 4096;
    for (let i = 0; i < body.length; i += chunkSize) {
      await tlsConn.write(body.slice(i, Math.min(i + chunkSize, body.length)));
    }

    await tlsConn.write(encoder.encode("\r\n.\r\n"));
    await readResponse(tlsConn);
    await sendCommand(tlsConn, "QUIT");
    tlsConn.close();
  } catch (err: unknown) {
    try { if (tlsConn) tlsConn.close(); if (conn) conn.close(); } catch { /* ignore */ }
    throw new Error(`SMTP failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

serve(async (req) => {
  return await Sentry.withScope(async () => {
    Sentry.setTag("function", "accept-contract");
    if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

    try {
      const url = new URL(req.url);
      const contractId = url.searchParams.get("id");

      if (!contractId) {
        return new Response(htmlPage("Missing link", "This acceptance link is invalid.", false), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" },
        });
      }

      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const supabase = createClient(supabaseUrl, supabaseServiceKey);

      // Fetch full contract details needed for emails and notification
      const { data: contract, error: fetchError } = await supabase
        .from("contracts")
        .select("id, status, user_id, contract_number, recipient_name, recipient_email")
        .eq("id", contractId)
        .maybeSingle();

      if (fetchError || !contract) {
        console.error("accept-contract fetch:", fetchError);
        return new Response(
          htmlPage("Contract not found", "We could not find this agreement. Please contact the company that sent it.", false),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" } },
        );
      }

      const status = String(contract.status || "");

      if (status === "Active") {
        return new Response(
          htmlPage("Already accepted", "This contract has already been accepted.", true),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" } },
        );
      }

      if (!["Sent", "Pending"].includes(status)) {
        const msg = status === "Draft"
          ? "This agreement is not available for acceptance yet."
          : status === "Expired"
          ? "This agreement has expired. Please contact the service provider."
          : "This agreement can no longer be accepted online. Please contact the service provider.";
        return new Response(
          htmlPage("Unable to accept", msg, false),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" } },
        );
      }

      const now = new Date().toISOString();
      const { error: updateError } = await supabase
        .from("contracts")
        .update({ status: "Active", updated_at: now })
        .eq("id", contractId);

      if (updateError) {
        console.error("accept-contract update:", updateError);
        throw updateError;
      }

      // Fetch owner profile for emails
      const { data: profile } = await supabase
        .from("profiles")
        .select("company_name, company_email")
        .eq("user_id", contract.user_id)
        .maybeSingle();

      const companyName = profile?.company_name || "Thunder Pro";
      const ownerEmail = profile?.company_email || null;
      const contractNumber = contract.contract_number || contractId;
      const clientName = contract.recipient_name || "Client";
      const clientEmail = contract.recipient_email || null;

      // ── Owner notification email ─────────────────────────────────────────────
      if (ownerEmail) {
        const ownerHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:20px;font-family:Arial,sans-serif">
<div style="max-width:600px;margin:0 auto">

<div style="text-align:center;padding:15px;background:#1e3a8a;color:white">
<div style="font-size:48px;margin:10px 0">✓</div>
<h1 style="margin:0;font-size:22px">Contract Accepted</h1>
<p style="margin:5px 0">A client has accepted your service agreement</p>
</div>

<div style="padding:20px">
<div style="background:#f0fdf4;padding:12px;border-left:4px solid #10b981;margin-bottom:15px">
<p style="margin:0;font-weight:bold;color:#059669">${clientName} accepted contract ${contractNumber}</p>
</div>

<p>Your service agreement <strong>${contractNumber}</strong> has been accepted by <strong>${clientName}</strong>.</p>
<p style="font-size:13px;color:#6b7280">The contract is now active in your Thunder Pro dashboard.</p>
</div>

<div style="text-align:center;padding:15px;background:#1e3a8a;color:white">
<p style="margin:0;font-size:12px">© 2024 Thunder Pro Inc. | <a href="https://www.thunderpro.co" style="color:white">www.thunderpro.co</a></p>
</div>

</div>
</body>
</html>`;

        try {
          await sendEmailViaSMTP(
            ownerEmail,
            `${clientName} accepted contract ${contractNumber}`,
            ownerHtml,
          );
          console.log("Owner notification email sent to:", ownerEmail);
        } catch (emailErr) {
          console.error("Failed to send owner email:", emailErr);
          Sentry.captureException(emailErr);
        }
      }

      // ── Client confirmation email ────────────────────────────────────────────
      if (clientEmail) {
        const clientHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:20px;font-family:Arial,sans-serif">
<div style="max-width:600px;margin:0 auto">

<div style="text-align:center;padding:15px;background:#10b981;color:white">
<div style="font-size:48px;margin:10px 0">✓</div>
<h1 style="margin:0;font-size:22px">Agreement Confirmed</h1>
<p style="margin:5px 0">Thank you for accepting the service agreement</p>
</div>

<div style="padding:20px">
<p>Hello <strong>${clientName}</strong>,</p>
<p>You have successfully accepted the service agreement <strong>${contractNumber}</strong> from <strong>${companyName}</strong>.</p>
<p style="font-size:13px;color:#6b7280">The provider has been notified and will follow up with next steps.</p>
</div>

<div style="text-align:center;padding:15px;background:#1e3a8a;color:white">
<p style="margin:0;font-size:12px">© 2024 Thunder Pro Inc. | <a href="https://www.thunderpro.co" style="color:white">www.thunderpro.co</a></p>
</div>

</div>
</body>
</html>`;

        try {
          await sendEmailViaSMTP(
            clientEmail,
            `Agreement confirmed — ${contractNumber} from ${companyName}`,
            clientHtml,
          );
          console.log("Client confirmation email sent to:", clientEmail);
        } catch (emailErr) {
          console.error("Failed to send client email:", emailErr);
          Sentry.captureException(emailErr);
        }
      }

      // ── In-app notification for the owner ───────────────────────────────────
      try {
        await supabase.from("notifications").insert({
          user_id: contract.user_id,
          type: "contract_accepted",
          title: "Contract Accepted",
          message: `Contract ${contractNumber} for ${clientName} was accepted`,
          related_id: contractId,
          related_type: "contract",
          read: false,
        });
        console.log("Notification inserted for user:", contract.user_id);
      } catch (notifErr) {
        console.error("Failed to insert notification:", notifErr);
        Sentry.captureException(notifErr);
      }

      return new Response(
        htmlPage(
          "Contract accepted",
          "Thank you for accepting this service agreement. The provider has been notified and will follow up with next steps.",
          true,
        ),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" } },
      );
    } catch (e: unknown) {
      Sentry.captureException(e);
      console.error("accept-contract:", e);
      return new Response(
        htmlPage("Something went wrong", "We could not process your request. Please try again or contact support.", false),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" } },
      );
    }
  });
});
