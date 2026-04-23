import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import * as Sentry from "npm:@sentry/deno";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Sentry.init({
  dsn: "https://ce035a76b6157a602d88c53eab6570e4@o4509804047958016.ingest.us.sentry.io/4510552540971008",
  environment: Deno.env.get("SUPABASE_URL")?.includes("staging")
    ? "staging"
    : "production",
  tracesSampleRate: 0.1,
});

const INTERNAL_NOTIFY_EMAIL = "info@thunderpro.co";

interface WebhookPayload {
  type: string;
  table: string;
  record: Record<string, unknown>;
  schema: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function rowString(r: Record<string, unknown>, key: string): string {
  const v = r[key];
  if (v === null || v === undefined) return "";
  return String(v);
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
  const fromEmail = '"Thunder Pro" <info@thunderpro.co>';

  let conn: Deno.TcpConn | null = null;
  let tlsConn: Deno.TlsConn | null = null;

  try {
    conn = await Deno.connect({ hostname: smtpHost, port: smtpPort });

    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const readResponse = async (
      connection: Deno.TcpConn | Deno.TlsConn,
    ): Promise<string> => {
      const buffer = new Uint8Array(4096);
      const n = await connection.read(buffer);
      return decoder.decode(buffer.subarray(0, n || 0));
    };

    const sendCommand = async (
      connection: Deno.TcpConn | Deno.TlsConn,
      command: string,
      maskInLog: boolean = false,
    ): Promise<string> => {
      const displayCommand = maskInLog
        ? command.substring(0, 15) + "..."
        : command;
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
    await sendCommand(tlsConn, "DATA");

    const timestamp = Date.now();
    const randomId = Math.random().toString(36).substring(2, 15);
    const messageId = `<${timestamp}.${randomId}@thunderpro.co>`;

    const headers = [
      `From: ${fromEmail}`,
      `To: ${toEmail}`,
      `Subject: ${subject}`,
      `Message-ID: ${messageId}`,
      "X-Mailer: ThunderPro-InternalRegistration",
      "MIME-Version: 1.0",
      "Content-Type: text/html; charset=UTF-8",
      "",
    ].join("\r\n");

    await tlsConn.write(encoder.encode(headers + "\r\n"));

    const chunkSize = 4096;
    const contentBytes = encoder.encode(htmlContent);
    for (let i = 0; i < contentBytes.length; i += chunkSize) {
      const chunk = contentBytes.slice(
        i,
        Math.min(i + chunkSize, contentBytes.length),
      );
      await tlsConn.write(chunk);
    }

    await tlsConn.write(encoder.encode("\r\n.\r\n"));
    await readResponse(tlsConn);
    await sendCommand(tlsConn, "QUIT");
    tlsConn.close();
  } catch (e) {
    try {
      if (tlsConn) tlsConn.close();
      if (conn) conn.close();
    } catch {
      /* ignore */
    }
    throw e;
  }
}

const handler = async (req: Request): Promise<Response> => {
  return await Sentry.withScope(async (_scope) => {
    Sentry.setTag("function", "notify-internal-registration");

    if (req.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      const payload: WebhookPayload = await req.json();

      if (payload.type !== "INSERT" || payload.table !== "profiles") {
        return new Response(
          JSON.stringify({ message: "Ignored: not a profiles insert" }),
          {
            status: 200,
            headers: { "Content-Type": "application/json", ...corsHeaders },
          },
        );
      }

      const r = payload.record;
      const userId = rowString(r, "user_id");
      if (!userId) {
        throw new Error("Missing user_id on profile record");
      }

      const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
      if (!supabaseUrl || !serviceKey) {
        throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
      }

      const admin = createClient(supabaseUrl, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });

      const { data: userData, error: userErr } = await admin.auth.admin
        .getUserById(userId);
      if (userErr) {
        console.error("getUserById:", userErr);
      }

      const email = userData?.user?.email ?? "(unknown)";
      const meta = (userData?.user?.user_metadata ?? {}) as Record<
        string,
        unknown
      >;
      const platform =
        meta["platform"] != null ? String(meta["platform"]) : "";

      const first = rowString(r, "first_name");
      const last = rowString(r, "last_name");
      const phone = rowString(r, "phone_number");
      const company = rowString(r, "company_name");
      const companyState = rowString(r, "company_state") ||
        rowString(r, "state");
      const companyCountry = rowString(r, "company_country");
      const referral = rowString(r, "referral_code");

      const html = `<!DOCTYPE html>
<html><body style="font-family:Arial,sans-serif;font-size:15px;color:#111">
<p><strong>New Thunder Pro registration</strong></p>
<table style="border-collapse:collapse;max-width:560px">
<tr><td style="padding:4px 12px 4px 0;color:#555">Email</td><td>${escapeHtml(email)}</td></tr>
<tr><td style="padding:4px 12px 4px 0;color:#555">Name</td><td>${escapeHtml(`${first} ${last}`.trim())}</td></tr>
<tr><td style="padding:4px 12px 4px 0;color:#555">Phone</td><td>${escapeHtml(phone)}</td></tr>
<tr><td style="padding:4px 12px 4px 0;color:#555">Company</td><td>${escapeHtml(company)}</td></tr>
<tr><td style="padding:4px 12px 4px 0;color:#555">State / region</td><td>${escapeHtml(companyState)}</td></tr>
<tr><td style="padding:4px 12px 4px 0;color:#555">Country</td><td>${escapeHtml(companyCountry)}</td></tr>
<tr><td style="padding:4px 12px 4px 0;color:#555">Referral</td><td>${escapeHtml(referral)}</td></tr>
<tr><td style="padding:4px 12px 4px 0;color:#555">User ID</td><td style="font-size:13px">${escapeHtml(userId)}</td></tr>
<tr><td style="padding:4px 12px 4px 0;color:#555">Auth platform</td><td>${escapeHtml(platform)}</td></tr>
</table>
<p style="color:#666;font-size:13px;margin-top:16px">Sent automatically when a new profile row is created (signup).</p>
</body></html>`;

      await sendEmailViaSMTP(
        INTERNAL_NOTIFY_EMAIL,
        "New Thunder Pro user registration",
        html,
      );

      return new Response(
        JSON.stringify({ success: true }),
        {
          status: 200,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        },
      );
    } catch (error: unknown) {
      Sentry.captureException(error);
      const message = error instanceof Error ? error.message : String(error);
      console.error("notify-internal-registration:", message);
      return new Response(
        JSON.stringify({ success: false, error: message }),
        {
          status: 500,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        },
      );
    }
  });
};

serve(handler);
