/**
 * Walkthrough reached Converted (linked to estimate). Owner + client notification.
 * Invoked via send-walkthrough-status-emails (service role) or directly from apps.
 */
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.76.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const formatDate = (dateStr: string, timezone: string = "UTC"): string => {
  try {
    if (!dateStr) return "N/A";
    const [year, month, day] = dateStr.split("-").map(Number);
    const dateAtMidday = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    }).format(dateAtMidday);
  } catch {
    return dateStr;
  }
};

const formatTime = (timeStr: string): string => {
  if (!timeStr) return "Not specified";
  try {
    const parts = timeStr.split(":");
    const hour = parseInt(parts[0], 10);
    const minutes = parts[1] ? parseInt(parts[1], 10) : 0;
    const ampm = hour >= 12 ? "PM" : "AM";
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${minutes.toString().padStart(2, "0")} ${ampm}`;
  } catch {
    return timeStr;
  }
};

const ownerHtml = (walkthrough: any, contactInfo: any, companyInfo: any, tz: string): string => {
  const name = contactInfo.full_name || contactInfo.lead_name || "your client";
  return `<!DOCTYPE html><html><body style="margin:0;padding:20px;font-family:Arial,sans-serif">
<div style="max-width:600px;margin:0 auto">
<div style="text-align:center;padding:15px;background:#7c3aed;color:white">
  <h1 style="margin:0;font-size:22px">${companyInfo.company_name || "Your company"}</h1>
  <p style="margin:5px 0">Walkthrough converted to estimate</p>
</div>
<div style="padding:20px;background:#fafafa">
<p>Hello,</p>
<p>The walkthrough for <strong>${name}</strong> has been <strong>converted</strong> and linked to an estimate in your system.</p>
<p><strong>Original visit:</strong> ${formatDate(walkthrough.scheduled_date, tz)} at ${formatTime(walkthrough.scheduled_time)}<br>
<strong>Service:</strong> ${walkthrough.service_type || "—"}</p>
<p style="color:#4c1d95">You can send or finalize the estimate for this contact when ready.</p>
</div>
</div></body></html>`;
};

const clientHtml = (walkthrough: any, contactInfo: any, companyInfo: any, tz: string): string => {
  const name = contactInfo.full_name || contactInfo.lead_name || "Hello";
  return `<!DOCTYPE html><html><body style="margin:0;padding:20px;font-family:Arial,sans-serif">
<div style="max-width:600px;margin:0 auto">
<div style="text-align:center;padding:15px;background:#1e3a8a;color:white">
  <h1 style="margin:0;font-size:22px">${companyInfo.company_name || "Your cleaning provider"}</h1>
  <p style="margin:5px 0">Next steps</p>
</div>
<div style="padding:20px;background:#fafafa">
<p>Dear ${name},</p>
<p>Thank you for the walkthrough on <strong>${formatDate(walkthrough.scheduled_date, tz)}</strong>. We are preparing your estimate and will send it to you shortly.</p>
<p>If you have questions, reply to this email or call us at <strong>${companyInfo.company_phone || ""}</strong>.</p>
<p>— ${companyInfo.company_name || "The team"}</p>
</div>
</div></body></html>`;
};

async function sendEmailViaSMTP(toEmail: string, subject: string, htmlContent: string): Promise<void> {
  const smtpHost = "email-smtp.us-east-2.amazonaws.com";
  const smtpPort = 587;
  const smtpUser = Deno.env.get("AWS_SES_SMTP_USERNAME") || "";
  const smtpPass = Deno.env.get("AWS_SES_SMTP_PASSWORD") || "";
  const fromEmail = Deno.env.get("AWS_SES_FROM_EMAIL") || '"Thunder Pro" <info@thunderpro.co>';
  let fromEmailAddress = fromEmail;
  const m = fromEmail.match(/<([^>]+)>/);
  if (m) fromEmailAddress = m[1];
  else fromEmailAddress = fromEmail.trim();
  if (!smtpUser || !smtpPass) throw new Error("SMTP credentials not configured");

  let conn: Deno.TcpConn | null = null;
  let tlsConn: Deno.TlsConn | null = null;
  try {
    conn = await Deno.connect({ hostname: smtpHost, port: smtpPort });
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const readResponse = async (c: Deno.TcpConn | Deno.TlsConn) => {
      const buffer = new Uint8Array(4096);
      const n = await c.read(buffer);
      return decoder.decode(buffer.subarray(0, n || 0));
    };
    const sendCommand = async (c: Deno.TcpConn | Deno.TlsConn, cmd: string) => {
      await c.write(encoder.encode(cmd + "\r\n"));
      const response = await readResponse(c);
      const code = response.substring(0, 3);
      if (code.startsWith("4") || code.startsWith("5")) {
        throw new Error(`SMTP: ${response.trim()}`);
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
    await sendCommand(tlsConn, `MAIL FROM:<${fromEmailAddress}>`);
    await sendCommand(tlsConn, `RCPT TO:<${toEmail}>`);
    await sendCommand(tlsConn, "DATA");
    const messageId = `<${Date.now()}.${Math.random().toString(36).slice(2)}@thunderpro.co>`;
    const headers =
      `From: ${fromEmail}\r\nTo: ${toEmail}\r\nSubject: ${subject}\r\nMessage-ID: ${messageId}\r\nMIME-Version: 1.0\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n`;
    await tlsConn.write(encoder.encode(headers));
    const bytes = encoder.encode(htmlContent);
    for (let i = 0; i < bytes.length; i += 4096) {
      await tlsConn.write(bytes.subarray(i, Math.min(i + 4096, bytes.length)));
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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { walkthroughId } = await req.json();
    if (!walkthroughId) {
      return new Response(JSON.stringify({ error: "walkthroughId required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { data: walkthrough, error: wErr } = await supabase.from("walkthroughs").select("*").eq("id", walkthroughId).single();
    if (wErr || !walkthrough) {
      return new Response(JSON.stringify({ error: "Walkthrough not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: companyInfo } = await supabase
      .from("profiles")
      .select("company_name, company_email, company_phone, timezone")
      .eq("user_id", walkthrough.user_id)
      .maybeSingle();
    const tz = companyInfo?.timezone || "UTC";

    let contactInfo: any = null;
    if (walkthrough.walkthrough_type === "client" && walkthrough.client_id) {
      const { data: client } = await supabase.from("clients").select("*").eq("id", walkthrough.client_id).single();
      contactInfo = client;
    } else if (walkthrough.walkthrough_type === "lead" && walkthrough.lead_id) {
      const { data: lead } = await supabase.from("leads").select("*").eq("id", walkthrough.lead_id).maybeSingle();
      if (lead) {
        contactInfo = {
          full_name: lead.full_name,
          company: lead.company_name,
          phone: lead.phone,
          email: lead.email,
          service_street: lead.address,
          service_city: lead.city,
          service_state: lead.state,
          service_zip: lead.zip_code,
        };
      } else {
        const { data: booking } = await supabase.from("bookings").select("*").eq("id", walkthrough.lead_id).maybeSingle();
        if (booking) {
          contactInfo = {
            full_name: booking.lead_name,
            lead_name: booking.lead_name,
            phone: booking.phone,
            email: booking.email,
            street: booking.street,
            city: booking.city,
            state: booking.state,
            zip_code: booking.zip_code,
          };
        }
      }
    }
    if (!contactInfo) {
      return new Response(JSON.stringify({ error: "Contact not found" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: authUser } = await supabase.auth.admin.getUserById(walkthrough.user_id);
    const ownerEmail = companyInfo?.company_email || authUser?.user?.email || "";
    let ownerEmailSent = false;
    let clientEmailSent = false;

    if (ownerEmail) {
      await sendEmailViaSMTP(
        ownerEmail,
        "Walkthrough converted — estimate linked",
        ownerHtml(walkthrough, contactInfo, companyInfo || {}, tz),
      );
      ownerEmailSent = true;
    }

    const ce = contactInfo.email;
    if (ce) {
      try {
        await sendEmailViaSMTP(
          ce,
          "Your estimate is on the way",
          clientHtml(walkthrough, contactInfo, companyInfo || {}, tz),
        );
        clientEmailSent = true;
      } catch (e) {
        console.error("client converted email:", e);
      }
    }

    return new Response(
      JSON.stringify({ success: true, ownerEmailSent, clientEmailSent, contactHasEmail: !!ce }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("send-walkthrough-converted:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
