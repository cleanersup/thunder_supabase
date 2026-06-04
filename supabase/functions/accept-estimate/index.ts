import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import * as Sentry from "npm:@sentry/deno";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Sentry.init({
  dsn: "https://ce035a76b6157a602d88c53eab6570e4@o4509804047958016.ingest.us.sentry.io/4510552540971008",
  environment: Deno.env.get("SUPABASE_URL")?.includes("staging") ? "staging" : "production",
  tracesSampleRate: 0.1,
});

async function sendEmailViaSMTP(
  toEmail: string,
  subject: string,
  htmlContent: string,
): Promise<void> {
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
      await tlsConn.write(contentBytes.slice(i, Math.min(i + 4096, contentBytes.length)));
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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function generateOwnerAcceptedEmailHtml(
  estimateNumber: string,
  clientName: string,
  total: number,
  companyName: string,
): string {
  const amount = (Number(total) || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Estimate Accepted</title></head>
<body style="font-family:Segoe UI,Tahoma,sans-serif;background:#f3f4f6;padding:24px;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;">
    <h1 style="color:#1e3a8a;font-size:22px;margin:0 0 16px;">Estimate accepted</h1>
    <p style="color:#374151;line-height:1.6;">
      <strong>${escapeHtml(clientName)}</strong> accepted estimate
      <strong>${escapeHtml(estimateNumber)}</strong> for
      <strong>$${amount}</strong>.
    </p>
    <p style="color:#6b7280;font-size:14px;">Open Thunder Pro to view the estimate and schedule next steps.</p>
    <p style="color:#9ca3af;font-size:12px;margin-top:24px;">${escapeHtml(companyName)}</p>
  </div>
</body>
</html>`;
}

async function notifyOwnerOfEstimateAccepted(
  supabase: SupabaseClient,
  estimate: Record<string, unknown>,
): Promise<void> {
  const userId = String(estimate.user_id || "");
  if (!userId) {
    console.warn("accept-estimate: no user_id on estimate, skipping owner notify");
    return;
  }

  const estimateId = String(estimate.id || "");
  const clientName = String(estimate.client_name || "Client");
  const total = Number(estimate.total) || 0;
  const estimateNumber = estimateId
    ? `EST-${estimateId.slice(0, 6).toUpperCase()}`
    : "Estimate";

  const { data: profile } = await supabase
    .from("profiles")
    .select("company_name, company_email")
    .eq("user_id", userId)
    .maybeSingle();

  const companyName = profile?.company_name || "Thunder Pro";
  const ownerEmail = (profile?.company_email || "").trim();

  try {
    await supabase.from("notifications").insert({
      user_id: userId,
      type: "estimate_accepted",
      title: `Estimate ${estimateNumber} was accepted`,
      message: `Estimate ${estimateNumber} for ${clientName} was accepted ($${total.toFixed(2)})`,
      related_id: estimateId || null,
      related_type: "estimate",
      read: false,
    });
    console.log("accept-estimate: notification inserted for user:", userId);
  } catch (notifErr) {
    console.error("accept-estimate: failed to insert notification:", notifErr);
    Sentry.captureException(notifErr);
  }

  if (!ownerEmail) {
    console.warn("accept-estimate: no company_email on profile, skipping owner email");
    return;
  }

  try {
    const subject = `Estimate accepted — ${estimateNumber}`;
    const html = generateOwnerAcceptedEmailHtml(
      estimateNumber,
      clientName,
      total,
      companyName,
    );
    await sendEmailViaSMTP(ownerEmail, subject, html);
    console.log("accept-estimate: owner email sent to", ownerEmail);
  } catch (emailErr) {
    console.error("accept-estimate: owner email failed:", emailErr);
    Sentry.captureException(emailErr);
  }
}

serve(async (req) => {
  return await Sentry.withScope(async (scope) => {
    Sentry.setTag("function", "accept-estimate");

    if (req.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      const url = new URL(req.url);
      const estimateId = url.searchParams.get('id');

      if (!estimateId) {
        return new Response('Estimate ID is required', {
          status: 400,
          headers: corsHeaders
        });
      }

      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const supabase = createClient(supabaseUrl, supabaseServiceKey);

      console.log('Accepting estimate:', estimateId);

      const { data: existing, error: fetchError } = await supabase
        .from('estimates')
        .select('id, status, user_id, client_name, total')
        .eq('id', estimateId)
        .maybeSingle();

      if (fetchError) throw fetchError;
      if (!existing) {
        return new Response('Estimate not found', { status: 404, headers: corsHeaders });
      }

      const alreadyAccepted = String(existing.status || '').toLowerCase() === 'accepted';

      let estimate = existing;
      if (!alreadyAccepted) {
        const { data: updated, error: updateError } = await supabase
          .from('estimates')
          .update({
            status: 'Accepted',
            updated_at: new Date().toISOString()
          })
          .eq('id', estimateId)
          .select()
          .single();

        if (updateError) {
          console.error('Error updating estimate:', updateError);
          throw updateError;
        }
        estimate = updated;
        console.log('Estimate accepted successfully:', estimate);
      } else {
        console.log('Estimate already accepted:', estimateId);
      }

      if (!alreadyAccepted) {
        try {
          await notifyOwnerOfEstimateAccepted(supabase, estimate as Record<string, unknown>);
        } catch (notifyErr) {
          console.error('accept-estimate: notify owner failed:', notifyErr);
          Sentry.captureException(notifyErr);
        }
      }

      const htmlResponse = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Estimate Accepted</title>
        <style>
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
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
          .success-icon {
            width: 80px;
            height: 80px;
            background: linear-gradient(135deg, #10b981 0%, #059669 100%);
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0 auto 24px;
          }
          .checkmark {
            width: 40px;
            height: 40px;
            border: 4px solid white;
            border-radius: 50%;
            position: relative;
          }
          .checkmark::after {
            content: '';
            position: absolute;
            left: 8px;
            top: 3px;
            width: 10px;
            height: 18px;
            border: solid white;
            border-width: 0 4px 4px 0;
            transform: rotate(45deg);
          }
          h1 {
            color: #1e3a8a;
            font-size: 28px;
            margin-bottom: 16px;
          }
          p {
            color: #555;
            font-size: 16px;
            line-height: 1.6;
            margin-bottom: 32px;
          }
          .footer {
            color: #999;
            font-size: 14px;
            margin-top: 24px;
            padding-top: 24px;
            border-top: 1px solid #e5e7eb;
          }
          .footer a {
            color: #3b82f6;
            text-decoration: none;
            font-weight: 600;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="success-icon">
            <div class="checkmark"></div>
          </div>
          <h1>Estimate Accepted!</h1>
          <p>Thank you for accepting our estimate. We've received your confirmation and will be in touch shortly to schedule your service.</p>
          <p style="font-size: 14px; color: #777;">A confirmation has been sent to your email address.</p>
          <div class="footer">
            <p>© 2024 Thunder Pro Inc.<br>
            Visit us at <a href="https://www.thunderpro.co" target="_blank">www.thunderpro.co</a></p>
          </div>
        </div>
      </body>
      </html>
    `;

      return new Response(htmlResponse, {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'text/html; charset=utf-8',
        },
      });

    } catch (error: any) {
      Sentry.captureException(error);
      console.error('Error in accept-estimate function:', error);

      const errorHtml = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Error</title>
        <style>
          body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%);
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
          }
          h1 { color: #dc2626; margin-bottom: 16px; }
          p { color: #555; margin-bottom: 24px; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>Oops! Something went wrong</h1>
          <p>We couldn't process your request. Please contact us directly or try again later.</p>
        </div>
      </body>
      </html>
    `;

      return new Response(errorHtml, {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'text/html; charset=utf-8',
        },
      });
    }
  });
});
