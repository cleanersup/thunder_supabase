// Request magic link for Thunder Client Portal (email + merchant owner id).
// verify_jwt = false — public endpoint with constant-time response.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.76.1";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const LOGIN_LINK_EXPIRY_MIN = 15;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(s: string): boolean {
  return UUID_RE.test(s.trim());
}

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
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
  const fromEmail = Deno.env.get("AWS_SES_FROM_EMAIL") ||
    '"Thunder Pro" <info@thunderpro.co>';

  if (!smtpUser || !smtpPass) {
    console.warn("SMTP not configured — magic link email skipped");
    return;
  }

  let conn: Deno.TcpConn | null = null;
  let tlsConn: Deno.TlsConn | null = null;
  try {
    conn = await Deno.connect({ hostname: smtpHost, port: smtpPort });
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const readResponse = async (
      c: Deno.TcpConn | Deno.TlsConn,
    ): Promise<string> => {
      const buffer = new Uint8Array(4096);
      const n = await c.read(buffer);
      return decoder.decode(buffer.subarray(0, n || 0));
    };
    const sendCommand = async (
      c: Deno.TcpConn | Deno.TlsConn,
      command: string,
    ): Promise<string> => {
      await c.write(encoder.encode(command + "\r\n"));
      const response = await readResponse(c);
      const code = response.substring(0, 3);
      if (code.startsWith("4") || code.startsWith("5")) {
        throw new Error(`SMTP ${code}: ${response.trim()}`);
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
    const messageId = `<${Date.now()}.${Math.random().toString(36).slice(2)}@thunderpro.co>`;
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
    const bodyBytes = encoder.encode(htmlContent);
    for (let i = 0; i < bodyBytes.length; i += 4096) {
      await tlsConn.write(
        bodyBytes.slice(i, Math.min(i + 4096, bodyBytes.length)),
      );
    }
    await tlsConn.write(encoder.encode("\r\n.\r\n"));
    await readResponse(tlsConn);
    await sendCommand(tlsConn, "QUIT");
    tlsConn.close();
  } catch (e) {
    try {
      tlsConn?.close();
      conn?.close();
    } catch { /* ignore */ }
    throw e;
  }
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const t0 = Date.now();
  const genericMsg = {
    message: "If your email is registered, you'll receive an access link.",
  };

  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({})) as {
      email?: string;
      ownerId?: string;
    };

    const emailRaw = typeof body.email === "string" ? body.email.trim() : "";
    const ownerId = typeof body.ownerId === "string" ? body.ownerId.trim() : "";

    // Artificial delay to reduce timing side channels
    const delayMs = 320;
    await new Promise((r) => setTimeout(r, delayMs));

    if (!emailRaw || !ownerId || !isUuid(ownerId)) {
      const elapsed = Date.now() - t0;
      if (elapsed < 400) await new Promise((r) => setTimeout(r, 400 - elapsed));
      return new Response(JSON.stringify(genericMsg), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const emailNorm = emailRaw.toLowerCase();
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const { data: clientRow, error: clientErr } = await supabase
      .from("clients")
      .select("id")
      .eq("user_id", ownerId)
      .ilike("email", emailNorm)
      .maybeSingle();

    if (clientErr) {
      console.error("request-client-portal-magic-link client lookup:", clientErr);
    }

    if (!clientRow?.id) {
      const elapsed = Date.now() - t0;
      if (elapsed < 400) await new Promise((r) => setTimeout(r, 400 - elapsed));
      return new Response(JSON.stringify(genericMsg), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const portalBase = (Deno.env.get("CLIENT_PORTAL_URL") || "").replace(
      /\/$/,
      "",
    ) || "https://portal.thunderpro.co";
    const redirectTo = "/invoices";

    const plainToken = crypto.randomUUID() + crypto.randomUUID().replace(
      /-/g,
      "",
    );
    const tokenHash = await sha256Hex(plainToken);

    await supabase
      .from("client_magic_links")
      .update({ revoked_at: new Date().toISOString() })
      .eq("client_email", emailNorm)
      .eq("owner_id", ownerId)
      .is("used_at", null)
      .is("revoked_at", null);

    const expiresAt = new Date(Date.now() + LOGIN_LINK_EXPIRY_MIN * 60 * 1000)
      .toISOString();

    const { error: insErr } = await supabase.from("client_magic_links").insert({
      client_email: emailNorm,
      owner_id: ownerId,
      token_hash: tokenHash,
      source: "login",
      redirect_to: redirectTo,
      expires_at: expiresAt,
    });

    if (insErr) {
      console.error("request-client-portal-magic-link insert:", insErr);
      return new Response(JSON.stringify(genericMsg), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const callbackUrl =
      `${portalBase}/auth/callback?token=${encodeURIComponent(plainToken)}`;

    const html = `<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;line-height:1.5;color:#334155">
<p>Hello,</p>
<p>Click below to open your client portal:</p>
<p><a href="${callbackUrl}" style="display:inline-block;background:#2563eb;color:white;padding:12px 24px;border-radius:8px;text-decoration:none">Open portal</a></p>
<p style="font-size:13px">This link expires in ${LOGIN_LINK_EXPIRY_MIN} minutes. If you did not request it, you can ignore this email.</p>
</body></html>`;

    try {
      await sendEmailViaSMTP(emailRaw, "Your Thunder Pro client portal link", html);
    } catch (smtpErr) {
      console.error("request-client-portal-magic-link SMTP:", smtpErr);
    }

    const elapsed = Date.now() - t0;
    if (elapsed < 400) await new Promise((r) => setTimeout(r, 400 - elapsed));

    return new Response(JSON.stringify(genericMsg), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("request-client-portal-magic-link:", e);
    await new Promise((r) => setTimeout(r, 400));
    return new Response(JSON.stringify(genericMsg), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
