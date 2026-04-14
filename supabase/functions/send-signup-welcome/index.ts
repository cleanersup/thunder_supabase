import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.76.1";
import * as Sentry from "npm:@sentry/deno";
import {
  buildWelcomeEmailHtml,
  buildWelcomePlainText,
  SIGNUP_WELCOME_EMAIL_SUBJECT,
} from "./welcomeCopy.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Sentry.init({
  dsn: "https://ce035a76b6157a602d88c53eab6570e4@o4509804047958016.ingest.us.sentry.io/4510552540971008",
  environment: Deno.env.get("SUPABASE_URL")?.includes("staging") ? "staging" : "production",
  tracesSampleRate: 0.1,
});

interface Body {
  userId?: string;
}

/** Same normalization as send-invoice-sms (US +1). */
function normalizePhoneNumber(phone: string): string {
  const cleaned = phone.replace(/[^\d+]/g, "");
  if (cleaned.startsWith("+1")) return cleaned;
  const digits = cleaned.startsWith("+") ? cleaned.slice(1) : cleaned;
  return `+1${digits}`;
}

async function sendEmailViaSMTP(toEmail: string, subject: string, htmlContent: string): Promise<void> {
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

    const sendCommand = async (
      connection: Deno.TcpConn | Deno.TlsConn,
      command: string,
      maskInLog = false,
    ): Promise<string> => {
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
    await sendCommand(tlsConn, "DATA");

    const timestamp = Date.now();
    const randomId = Math.random().toString(36).substring(2, 15);
    const messageId = `<${timestamp}.${randomId}@thunderpro.co>`;
    const headers = [
      `From: ${fromEmail}`,
      `To: ${toEmail}`,
      `Subject: ${subject}`,
      `Message-ID: ${messageId}`,
      "X-Mailer: ThunderPro-SignupWelcome",
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
    } catch {
      /* ignore */
    }
    throw new Error(`Failed to send email: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function sendTwilioSms(toPhone: string, body: string): Promise<void> {
  const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  const twilioPhone = Deno.env.get("TWILIO_PHONE_NUMBER");
  if (!accountSid || !authToken || !twilioPhone) {
    throw new Error("Missing Twilio credentials");
  }
  const normalized = normalizePhoneNumber(toPhone);
  const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const response = await fetch(twilioUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: "Basic " + btoa(`${accountSid}:${authToken}`),
    },
    body: new URLSearchParams({
      To: normalized,
      From: twilioPhone,
      Body: body,
    }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || data.error_message || "Failed to send SMS");
  }
}

serve(async (req: Request): Promise<Response> => {
  return await Sentry.withScope(async () => {
    Sentry.setTag("function", "send-signup-welcome");

    if (req.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      if (req.method !== "POST") {
        return new Response(JSON.stringify({ error: "Method not allowed" }), {
          status: 405,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }

      const authHeader = req.headers.get("Authorization");
      if (!authHeader?.startsWith("Bearer ")) {
        return new Response(JSON.stringify({ error: "Authentication required" }), {
          status: 401,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }

      const { userId } = (await req.json()) as Body;
      if (!userId || typeof userId !== "string") {
        return new Response(JSON.stringify({ error: "userId is required" }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }

      const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
      const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
      const token = authHeader.replace("Bearer ", "");

      const supabaseUser = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });

      const { data: { user }, error: authErr } = await supabaseUser.auth.getUser(token);
      if (authErr || !user?.id) {
        return new Response(JSON.stringify({ error: "Invalid session" }), {
          status: 401,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }

      if (user.id !== userId) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }

      const supabaseAdmin = createClient(supabaseUrl, serviceKey);

      const { data: profile, error: profileError } = await supabaseAdmin
        .from("profiles")
        .select("first_name, phone_number")
        .eq("user_id", userId)
        .maybeSingle();

      if (profileError) {
        console.error("[send-signup-welcome] profile fetch error:", profileError);
        throw new Error("Could not load profile");
      }
      if (!profile) {
        return new Response(JSON.stringify({ error: "Profile not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }

      const { data: adminUser, error: adminErr } = await supabaseAdmin.auth.admin.getUserById(userId);
      if (adminErr) {
        console.error("[send-signup-welcome] admin getUser error:", adminErr);
      }
      const email = adminUser?.user?.email?.trim() ?? "";
      const phone = (profile.phone_number as string | null | undefined)?.trim() ?? "";

      const plain = buildWelcomePlainText(profile.first_name as string | null | undefined);

      let smsOk: boolean | null = null;
      let emailOk: boolean | null = null;

      if (phone) {
        try {
          await sendTwilioSms(phone, plain);
          smsOk = true;
          console.log("[send-signup-welcome] SMS sent for user", userId);
        } catch (smsErr) {
          smsOk = false;
          Sentry.captureException(smsErr);
          console.error("[send-signup-welcome] SMS failed:", smsErr);
        }
      } else {
        console.warn("[send-signup-welcome] No phone on profile; skipping SMS");
        smsOk = null;
      }

      if (email) {
        try {
          const html = buildWelcomeEmailHtml(profile.first_name as string | null | undefined);
          await sendEmailViaSMTP(email, SIGNUP_WELCOME_EMAIL_SUBJECT, html);
          emailOk = true;
          console.log("[send-signup-welcome] Email sent for user", userId);
        } catch (mailErr) {
          emailOk = false;
          Sentry.captureException(mailErr);
          console.error("[send-signup-welcome] Email failed:", mailErr);
        }
      } else {
        console.warn("[send-signup-welcome] No email on auth user; skipping email");
        emailOk = null;
      }

      return new Response(
        JSON.stringify({
          success: true,
          sms: smsOk === null ? "skipped" : smsOk ? "sent" : "failed",
          email: emailOk === null ? "skipped" : emailOk ? "sent" : "failed",
        }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } },
      );
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
