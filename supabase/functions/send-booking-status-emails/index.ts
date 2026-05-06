import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type BookingRow = {
  id: string;
  lead_name: string;
  email: string;
  phone: string;
  service_type: string;
  street: string;
  city: string;
  state: string;
  zip_code: string;
  business_owner_id: string;
};

interface StatusPayload {
  bookingId: string;
  previousStatus: string;
  newStatus: string;
}

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
      /* ignore */
    }
    throw error;
  }
}

function detailBlock(b: BookingRow, companyName: string): string {
  return `
    <div class="details">
      <div class="detail-row"><span class="detail-label">Service:</span> ${b.service_type}</div>
      <div class="detail-row"><span class="detail-label">Address:</span> ${b.street}, ${b.city}, ${b.state} ${b.zip_code}</div>
      <div class="detail-row"><span class="detail-label">Phone:</span> ${b.phone}</div>
      <div class="detail-row"><span class="detail-label">Company:</span> ${companyName}</div>
    </div>`;
}

function wrapLead(headerClass: string, title: string, bodyHtml: string, b: BookingRow, companyName: string): string {
  return `
      <!DOCTYPE html><html><head><style>
        body { font-family: Arial, sans-serif; line-height: 1.55; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
        .indigo { background-color: #4F46E5; }
        .green { background-color: #10B981; }
        .content { background-color: #f9f9f9; padding: 24px; }
        .details { background-color: white; padding: 16px; margin: 16px 0; border-radius: 8px; }
        .detail-row { padding: 8px 0; border-bottom: 1px solid #eee; }
        .detail-label { font-weight: bold; color: #4F46E5; }
        .footer { text-align: center; padding: 16px; color: #666; font-size: 12px; }
      </style></head><body>
      <div class="container">
        <div class="header ${headerClass}"><h1 style="margin:0;">${title}</h1></div>
        <div class="content">${bodyHtml}${detailBlock(b, companyName)}</div>
        <div class="footer">Automated message from ${companyName}</div>
      </div></body></html>`;
}

function wrapOwner(headerClass: string, title: string, bodyHtml: string, b: BookingRow, companyName: string): string {
  return `
      <!DOCTYPE html><html><head><style>
        body { font-family: Arial, sans-serif; line-height: 1.55; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
        .green { background-color: #10B981; }
        .indigo { background-color: #4F46E5; }
        .content { background-color: #f9f9f9; padding: 24px; }
        .details { background-color: white; padding: 16px; margin: 16px 0; border-radius: 8px; }
        .detail-row { padding: 8px 0; border-bottom: 1px solid #eee; }
        .detail-label { font-weight: bold; color: #10B981; }
      </style></head><body>
      <div class="container">
        <div class="header ${headerClass}"><h1 style="margin:0;">${title}</h1></div>
        <div class="content">${bodyHtml}${detailBlock(b, companyName)}</div>
      </div></body></html>`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { bookingId, previousStatus, newStatus } = await req.json() as StatusPayload;
    if (!bookingId || !newStatus) {
      return new Response(JSON.stringify({ error: "bookingId and newStatus are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    const { data: booking, error: bErr } = await supabase.from("bookings").select("*").eq("id", bookingId).single();
    if (bErr || !booking) {
      console.error("booking load:", bErr);
      return new Response(JSON.stringify({ error: "Booking not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const b = booking as BookingRow;
    const { data: profile } = await supabase
      .from("profiles")
      .select("company_name")
      .eq("user_id", b.business_owner_id)
      .maybeSingle();
    const companyName = profile?.company_name || "Your cleaning provider";

    const { data: authUser, error: authErr } = await supabase.auth.admin.getUserById(b.business_owner_id);
    if (authErr || !authUser?.user?.email) {
      console.error("owner email:", authErr);
      return new Response(JSON.stringify({ error: "Could not resolve business owner email" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const ownerEmail = authUser.user.email;

    let conversionHint = "";
    if (newStatus === "converted") {
      const { data: est } = await supabase.from("estimates").select("id").eq("booking_id", bookingId).limit(1).maybeSingle();
      const { data: wt } = await supabase.from("walkthroughs").select("id").eq("booking_id", bookingId).limit(1).maybeSingle();
      if (est?.id) conversionHint = "an estimate";
      else if (wt?.id) conversionHint = "a walkthrough";
      else conversionHint = "the next step in our process";
    }

    let leadSubject: string;
    let ownerSubject: string;
    let leadHtml: string;
    let ownerHtml: string;

    switch (newStatus) {
      case "converted":
        leadSubject = `Update — your booking with ${companyName}`;
        ownerSubject = `Booking converted — ${b.lead_name}`;
        leadHtml = wrapLead(
          "indigo",
          "Booking update",
          `<p>Dear ${b.lead_name},</p><p>Your service request has been moved forward as ${conversionHint}. We will follow up with any next steps.</p>`,
          b,
          companyName,
        );
        ownerHtml = wrapOwner(
          "green",
          "Booking converted",
          `<p>The booking for <strong>${b.lead_name}</strong> (${b.email}) was converted (previous status: ${previousStatus}).</p>`,
          b,
          companyName,
        );
        break;
      case "cancelled":
        leadSubject = `Booking cancelled — ${companyName}`;
        ownerSubject = `Booking cancelled — ${b.lead_name}`;
        leadHtml = wrapLead(
          "indigo",
          "Booking cancelled",
          `<p>Dear ${b.lead_name},</p><p>Your booking request with ${companyName} has been cancelled. If you have questions, reply to this email or call us.</p>`,
          b,
          companyName,
        );
        ownerHtml = wrapOwner(
          "green",
          "Booking cancelled",
          `<p>You marked the booking for <strong>${b.lead_name}</strong> as cancelled (was: ${previousStatus}).</p>`,
          b,
          companyName,
        );
        break;
      case "archived":
        leadSubject = `Booking archived — ${companyName}`;
        ownerSubject = `Booking archived — ${b.lead_name}`;
        leadHtml = wrapLead(
          "indigo",
          "Booking archived",
          `<p>Dear ${b.lead_name},</p><p>Your booking request has been archived by ${companyName}. Contact us if you still need service.</p>`,
          b,
          companyName,
        );
        ownerHtml = wrapOwner(
          "green",
          "Booking archived",
          `<p>Booking for <strong>${b.lead_name}</strong> was archived (was: ${previousStatus}).</p>`,
          b,
          companyName,
        );
        break;
      case "new":
        leadSubject = `Booking restored — ${companyName}`;
        ownerSubject = `Booking restored — ${b.lead_name}`;
        leadHtml = wrapLead(
          "indigo",
          "Booking restored",
          `<p>Dear ${b.lead_name},</p><p>Your booking request is active again with ${companyName}. We will be in touch as needed.</p>`,
          b,
          companyName,
        );
        ownerHtml = wrapOwner(
          "green",
          "Booking restored",
          `<p>Booking for <strong>${b.lead_name}</strong> was restored to <strong>new</strong> (was: ${previousStatus}).</p>`,
          b,
          companyName,
        );
        break;
      default:
        leadSubject = `Booking update — ${companyName}`;
        ownerSubject = `Booking status ${newStatus} — ${b.lead_name}`;
        leadHtml = wrapLead(
          "indigo",
          "Booking update",
          `<p>Dear ${b.lead_name},</p><p>Your booking status was updated to <strong>${newStatus}</strong>.</p>`,
          b,
          companyName,
        );
        ownerHtml = wrapOwner(
          "green",
          "Booking status changed",
          `<p>Booking for <strong>${b.lead_name}</strong> changed from ${previousStatus} to <strong>${newStatus}</strong>.</p>`,
          b,
          companyName,
        );
    }

    await sendEmailViaSMTP(b.email, leadSubject, leadHtml);
    await sendEmailViaSMTP(ownerEmail, ownerSubject, ownerHtml);

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    console.error(err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
