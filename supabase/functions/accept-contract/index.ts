import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.76.1";
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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Same layout as send-contract-email owner template — confirmation copy + Download PDF only. */
function generateContractAcceptedEmailHtml(
  contract: Record<string, unknown>,
  companyName: string,
  publicSupabaseUrl: string,
  audience: "client" | "owner" | "both",
): string {
  const token = contract.public_share_token || contract.id;
  const pdfUrl =
    `${publicSupabaseUrl}/functions/v1/download-contract-pdf?token=${encodeURIComponent(String(token))}`;
  const total = formatMoney(Number(contract.total));
  const start = formatDate(contract.start_date as string | null);
  const end = formatDate(contract.end_date as string | null);
  const contractNo = escapeHtml(String(contract.contract_number || ""));
  const clientName = escapeHtml(String(contract.recipient_name || ""));

  let intro: string;
  if (audience === "client") {
    intro =
      "Thank you. Your acceptance of this service agreement is confirmed. You can download the full agreement below.";
  } else if (audience === "owner") {
    intro =
      `${escapeHtml(String(contract.recipient_name || "The client"))} has accepted this service agreement. Download the full agreement below.`;
  } else {
    intro =
      `This service agreement (${contractNo}) for ${clientName} has been accepted. Download the full agreement below.`;
  }

  const headerLine = audience === "owner" ? "Contract accepted — your copy" : "Contract accepted";

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
<p style="margin:5px 0">${headerLine}</p>
</div>
<div style="padding:15px">
<p style="color:#6b7280;font-size:14px">${intro}</p>
<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Client</h3>
<div style="border-top:1px solid #1e3a8a;margin-bottom:12px"></div>
<p><strong>Name:</strong> ${escapeHtml(String(contract.recipient_name || ""))}<br>
<strong>Email:</strong> ${escapeHtml(String(contract.recipient_email || ""))}<br>
<strong>Phone:</strong> ${escapeHtml(String(contract.recipient_phone || ""))}<br>
<strong>Address:</strong> ${escapeHtml(String(contract.recipient_address || ""))}</p>

<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Contract details</h3>
<div style="border-top:1px solid #1e3a8a;margin-bottom:12px"></div>
<p><strong>Agreement #:</strong> ${contractNo}<br>
<strong>Period:</strong> ${escapeHtml(start)} — ${escapeHtml(end)}<br>
<strong>Payment frequency:</strong> ${escapeHtml(String(contract.payment_frequency || "—"))}</p>

<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Contract value</h3>
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

async function sendContractAcceptedNotifications(
  supabase: SupabaseClient,
  contract: Record<string, unknown>,
): Promise<void> {
  const publicSupabaseUrl = Deno.env.get("PUBLIC_APP_URL") || Deno.env.get("APP_URL") || "https://staging.thunderpro.co";
  const userId = String(contract.user_id || "");
  if (!userId) {
    console.warn("accept-contract: no user_id on contract, skipping emails");
    return;
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("company_name, company_email")
    .eq("user_id", userId)
    .maybeSingle();

  const companyName = profile?.company_name || "Company Name";
  const ownerEmailRaw = (profile?.company_email || "").trim();
  const clientEmailRaw = String(contract.recipient_email || "").trim();

  const contractNo = String(contract.contract_number || "Agreement");
  const subject = `Contract accepted — ${contractNo}`;

  const clientNorm = clientEmailRaw.toLowerCase();
  const ownerNorm = ownerEmailRaw.toLowerCase();

  if (clientNorm && ownerNorm && clientNorm === ownerNorm) {
    const html = generateContractAcceptedEmailHtml(contract, companyName, publicSupabaseUrl, "both");
    await sendEmailViaSMTP(clientEmailRaw, null, subject, html);
    console.log("accept-contract: sent single acceptance email (same address for client and owner)");
    return;
  }

  if (clientEmailRaw) {
    const clientHtml = generateContractAcceptedEmailHtml(contract, companyName, publicSupabaseUrl, "client");
    await sendEmailViaSMTP(clientEmailRaw, null, subject, clientHtml);
    console.log("accept-contract: sent client acceptance email");
  } else {
    console.warn("accept-contract: no recipient_email, skipping client email");
  }

  if (ownerEmailRaw && ownerNorm !== clientNorm) {
    console.log("accept-contract: waiting before owner email (reduce threading)");
    await new Promise((r) => setTimeout(r, 3000));
    const ownerHtml = generateContractAcceptedEmailHtml(contract, companyName, publicSupabaseUrl, "owner");
    await sendEmailViaSMTP(ownerEmailRaw, null, subject, ownerHtml);
    console.log("accept-contract: sent owner acceptance email");
  } else if (!ownerEmailRaw) {
    console.warn("accept-contract: no company_email on profile, skipping owner email");
  }
}

function jsonResponse(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

serve(async (req) => {
  return await Sentry.withScope(async () => {
    Sentry.setTag("function", "accept-contract");
    if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const respondJson = req.method === "POST";
    let body: Record<string, unknown> = {};

    if (req.method === "POST") {
      try {
        body = await req.json() as Record<string, unknown>;
      } catch {
        return jsonResponse({ error: "Invalid JSON body" }, 400);
      }
    }

    const url = new URL(req.url);
    let contractId: string | null = null;

    if (typeof body.token === "string" && body.token.trim()) {
      const { data } = await supabase
        .from("contracts")
        .select("id")
        .eq("public_share_token", body.token.trim())
        .maybeSingle();
      contractId = data?.id ?? null;
    } else if (typeof body.id === "string" && body.id.trim()) {
      contractId = body.id.trim();
    } else if (req.method === "GET") {
      const idQ = url.searchParams.get("id");
      const tokenQ = url.searchParams.get("token");
      if (idQ) contractId = idQ;
      else if (tokenQ) {
        const { data } = await supabase
          .from("contracts")
          .select("id")
          .eq("public_share_token", tokenQ)
          .maybeSingle();
        contractId = data?.id ?? null;
      }
    }

    const failHtml = (status: number, title: string, message: string, ok = false) =>
      new Response(htmlPage(title, message, ok), {
        status,
        headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" },
      });

    if (!contractId) {
      if (respondJson) return jsonResponse({ error: "Contract id or token required" }, 400);
      return failHtml(400, "Missing link", "This acceptance link is invalid.", false);
    }

    try {
      const { data: row, error: fetchError } = await supabase
        .from("contracts")
        .select("id, status")
        .eq("id", contractId)
        .maybeSingle();

      if (fetchError || !row) {
        console.error("accept-contract fetch:", fetchError);
        if (respondJson) return jsonResponse({ error: "Contract not found" }, 404);
        return failHtml(
          404,
          "Contract not found",
          "We could not find this agreement. Please contact the company that sent it.",
          false,
        );
      }

      const status = String(row.status || "");

      if (status === "Active") {
        if (respondJson) return jsonResponse({ success: true, alreadyAccepted: true }, 200);
        return failHtml(200, "Already accepted", "This contract has already been accepted.", true);
      }

      if (!["Sent", "Pending"].includes(status)) {
        const msg = status === "Draft"
          ? "This agreement is not available for acceptance yet."
          : status === "Expired"
          ? "This agreement has expired. Please contact the service provider."
          : "This agreement can no longer be accepted online. Please contact the service provider.";
        if (respondJson) return jsonResponse({ error: msg }, 400);
        return failHtml(400, "Unable to accept", msg, false);
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

      const { data: fullContract, error: fullErr } = await supabase
        .from("contracts")
        .select("*")
        .eq("id", contractId)
        .single();

      if (!fullErr && fullContract) {
        try {
          await sendContractAcceptedNotifications(supabase, fullContract as Record<string, unknown>);
        } catch (emailErr) {
          console.error("accept-contract email:", emailErr);
          Sentry.captureException(emailErr);
        }
      }

      if (respondJson) {
        return jsonResponse({ success: true, message: "Contract accepted" }, 200);
      }

      return failHtml(
        200,
        "Contract accepted",
        "Thank you for accepting this service agreement. The provider has been notified and will follow up with next steps.",
        true,
      );
    } catch (e: unknown) {
      Sentry.captureException(e);
      console.error("accept-contract:", e);
      const msg = "We could not process your request. Please try again or contact support.";
      if (respondJson) {
        return jsonResponse({ error: e instanceof Error ? e.message : msg }, 500);
      }
      return failHtml(500, "Something went wrong", msg, false);
    }
  });
});
