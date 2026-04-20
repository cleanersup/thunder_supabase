import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
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

interface PaymentRequest {
  invoiceId: string;
  paymentMethod?: string;
}

// SMTP email sending function
async function sendEmailViaSMTP(
  toEmail: string,
  bccEmail: string | null,
  subject: string,
  htmlContent: string
): Promise<void> {
  console.log('=== Starting SMTP Email Process ===');

  const smtpHost = "email-smtp.us-east-2.amazonaws.com";
  const smtpPort = 587;
  const smtpUser = Deno.env.get('AWS_SES_SMTP_USERNAME') || '';
  const smtpPass = Deno.env.get('AWS_SES_SMTP_PASSWORD') || '';
  const fromEmail = '"Thunder Pro" <info@thunderpro.co>';

  let conn: Deno.TcpConn | null = null;
  let tlsConn: Deno.TlsConn | null = null;

  try {
    console.log('[1/10] Connecting to SMTP server...');
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
      stepName: string,
      maskInLog: boolean = false
    ): Promise<string> => {
      await connection.write(encoder.encode(command + '\r\n'));
      const response = await readResponse(connection);
      const responseCode = response.substring(0, 3);
      if (responseCode.startsWith('4') || responseCode.startsWith('5')) {
        throw new Error(`SMTP Error ${responseCode}: ${response.trim()}`);
      }
      return response;
    };

    await readResponse(conn);
    await sendCommand(conn, 'EHLO thunderpro.co', '[3/10]');
    await sendCommand(conn, 'STARTTLS', '[4/10]');

    console.log('[5/10] Upgrading to TLS...');
    tlsConn = await Deno.startTls(conn, { hostname: smtpHost });

    await sendCommand(tlsConn, 'EHLO thunderpro.co', '[6/10]');
    await tlsConn.write(encoder.encode('AUTH LOGIN\r\n'));
    await readResponse(tlsConn);

    await sendCommand(tlsConn, btoa(smtpUser), '[7/10]', true);
    await sendCommand(tlsConn, btoa(smtpPass), '[7/10]', true);

    await sendCommand(tlsConn, `MAIL FROM:<info@thunderpro.co>`, '[8/10]');
    await sendCommand(tlsConn, `RCPT TO:<${toEmail}>`, '[8/10]');

    if (bccEmail && bccEmail !== toEmail) {
      await sendCommand(tlsConn, `RCPT TO:<${bccEmail}>`, '[8/10]');
    }

    await sendCommand(tlsConn, 'DATA', '[9/10]');

    const timestamp = Date.now();
    const randomId = Math.random().toString(36).substring(2, 15);
    const messageId = `<${timestamp}.${randomId}@thunderpro.co>`;

    const headers = [
      `From: ${fromEmail}`,
      `To: ${toEmail}`,
      `Subject: ${subject}`,
      `Message-ID: ${messageId}`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=UTF-8',
      '',
    ].join('\r\n');

    await tlsConn.write(encoder.encode(headers + '\r\n'));

    const chunkSize = 4096;
    const contentBytes = encoder.encode(htmlContent);

    for (let i = 0; i < contentBytes.length; i += chunkSize) {
      const chunk = contentBytes.slice(i, Math.min(i + chunkSize, contentBytes.length));
      await tlsConn.write(chunk);
    }

    await tlsConn.write(encoder.encode('\r\n.\r\n'));
    await readResponse(tlsConn);
    await sendCommand(tlsConn, 'QUIT', '[10/10]');
    tlsConn.close();
    console.log('=== Email sent successfully ===');

  } catch (error: any) {
    console.error('=== SMTP Error ===', error.message);
    try {
      if (tlsConn) tlsConn.close();
      if (conn) conn.close();
    } catch (closeError) {
      console.error('Error closing connections:', closeError);
    }
    throw new Error(`Failed to send email via SMTP: ${error.message}`);
  }
}

serve(async (req) => {
  return await Sentry.withScope(async (scope) => {
    Sentry.setTag("function", "process-invoice-payment");

    if (req.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      const { invoiceId, paymentMethod = 'online' }: PaymentRequest = await req.json();
      console.log('Processing payment for invoice:', invoiceId);

      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const supabase = createClient(supabaseUrl, supabaseKey);

      // Fetch invoice details
      const { data: invoice, error: invoiceError } = await supabase
        .from('invoices')
        .select('*')
        .eq('id', invoiceId)
        .single();

      if (invoiceError || !invoice) {
        throw new Error('Invoice not found');
      }

      // Check if already paid (DB uses title-case per invoices_status_check)
      if (invoice.status === 'Paid') {
        throw new Error('Invoice already paid');
      }

      // Update invoice status to paid
      const { error: updateError } = await supabase
        .from('invoices')
        .update({
          status: 'Paid',
          payment_method: paymentMethod,
          paid_date: new Date().toISOString().split('T')[0],
        })
        .eq('id', invoiceId);

      if (updateError) {
        throw updateError;
      }

      // Record detailed payment history
      const { error: paymentError } = await supabase
        .from('payments')
        .insert({
          user_id: invoice.user_id,
          invoice_id: invoiceId,
          amount: invoice.total,
          currency: 'usd',
          status: 'succeeded',
          payment_method: paymentMethod,
          metadata: {
            source: 'process-invoice-payment',
            processed_at: new Date().toISOString()
          }
        });

      if (paymentError) {
        console.error('Error recording payment:', paymentError);
        // We don't throw here as the invoice is already marked as paid
      }

      // Fetch company profile
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('company_name, company_email, company_logo')
        .eq('user_id', invoice.user_id)
        .single();

      if (profileError || !profile) {
        throw new Error('Company profile not found');
      }

      const companyName = profile.company_name || 'Our Company';
      const companyEmail = profile.company_email;
      const f = (n: number) => `$${n.toFixed(2)}`;

      // Client Payment Confirmation - Same design as estimates
      const clientConfirmationHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
@media only screen and (max-width: 600px) {
  .email-container { max-width: 100% !important; }
  .email-body { padding: 10px !important; }
  .email-content { padding: 10px !important; }
}
</style>
</head>
<body style="margin:0;padding:20px;font-family:Arial,sans-serif">
<div class="email-container" style="max-width:600px;margin:0 auto">

<div class="email-body" style="text-align:center;padding:15px;background:#10b981;color:white">
<div style="font-size:48px;margin:10px 0">✓</div>
<h1 style="margin:0;font-size:22px">Payment Successful</h1>
<p style="margin:5px 0">Thank you for your payment</p>
</div>

<div class="email-content" style="padding:15px">

<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Payment Confirmation</h3>
<div style="border-top:1px solid #1e3a8a;margin-bottom:12px"></div>
<p>Hello ${invoice.client_name},</p>
<p>Your payment to <strong>${companyName}</strong> has been successfully processed.</p>

<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Payment Details</h3>
<table cellpadding="0" cellspacing="0" style="width:100%;background-color:#f0fdf4">
  <tr>
    <td style="padding:16px">
      <table cellpadding="0" cellspacing="0" style="width:100%">
        <tr>
          <td style="padding:8px 0;text-align:left">Invoice Number:</td>
          <td style="padding:8px 0;text-align:right">${invoice.invoice_number}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;text-align:left">Payment Date:</td>
          <td style="padding:8px 0;text-align:right">${new Date().toLocaleDateString()}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;text-align:left">Payment Method:</td>
          <td style="padding:8px 0;text-align:right">${paymentMethod.charAt(0).toUpperCase() + paymentMethod.slice(1)}</td>
        </tr>
        <tr>
          <td style="padding:12px 0 0 0;text-align:left;font-weight:bold;font-size:20px;color:#10b981;border-top:1px solid #d1d5db">Amount Paid:</td>
          <td style="padding:12px 0 0 0;text-align:right;font-weight:bold;font-size:20px;color:#10b981;border-top:1px solid #d1d5db">${f(invoice.total)}</td>
        </tr>
      </table>
    </td>
  </tr>
</table>

<div style="background:#eff6ff;border-left:4px solid #3b82f6;padding:12px;margin:20px 0">
<p style="margin:0;font-size:13px;color:#1e40af">💡 A receipt has been generated for your records. If you need any assistance, please contact us.</p>
</div>

<p style="margin-top:20px;font-size:13px;color:#6c757d">Thank you for choosing ${companyName}. We appreciate your business!</p>

</div>

<div style="text-align:center;padding:15px;background:#1e3a8a;color:white">
<p style="margin:0 0 5px 0;font-size:12px">Service provided by</p>
<p style="margin:0">© 2024 Thunder Pro Inc. | <a href="https://www.thunderpro.co" style="color:white">www.thunderpro.co</a></p>
</div>

</div>
</body>
</html>`;

      // Owner Payment Notification - Same design as estimates
      const ownerNotificationHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
@media only screen and (max-width: 600px) {
  .email-container { max-width: 100% !important; }
  .email-body { padding: 10px !important; }
  .email-content { padding: 10px !important; }
}
</style>
</head>
<body style="margin:0;padding:20px;font-family:Arial,sans-serif">
<div class="email-container" style="max-width:600px;margin:0 auto">

<div class="email-body" style="text-align:center;padding:15px;background:#1e3a8a;color:white">
<p style="margin:0;font-size:14px;font-weight:bold;background:#1e40af;padding:8px;border-radius:4px">OWNER COPY - INTERNAL USE ONLY</p>
<div style="font-size:48px;margin:10px 0">💰</div>
<h1 style="margin:0;font-size:22px">Payment Received</h1>
<p style="margin:5px 0">Invoice has been paid</p>
</div>

<div class="email-content" style="padding:15px">

<div style="background:#f0fdf4;padding:12px;border-left:4px solid #10b981;margin-bottom:15px">
<p style="margin:0;font-weight:bold;color:#059669">Payment Successfully Received</p>
<p style="margin:5px 0 0 0;font-size:13px">${invoice.client_name} has just paid an invoice</p>
</div>

<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Client Information</h3>
<div style="border-top:1px solid #1e3a8a;margin-bottom:12px"></div>
<p><strong>Name:</strong> ${invoice.client_name}<br>
<strong>Email:</strong> ${invoice.email}<br>
<strong>Invoice Number:</strong> ${invoice.invoice_number}</p>

<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Payment Details</h3>
<table cellpadding="0" cellspacing="0" style="width:100%;background-color:#f0fdf4">
  <tr>
    <td style="padding:16px">
      <table cellpadding="0" cellspacing="0" style="width:100%">
        <tr>
          <td style="padding:8px 0;text-align:left">Payment Date:</td>
          <td style="padding:8px 0;text-align:right">${new Date().toLocaleDateString()}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;text-align:left">Payment Method:</td>
          <td style="padding:8px 0;text-align:right">${paymentMethod.charAt(0).toUpperCase() + paymentMethod.slice(1)}</td>
        </tr>
        <tr>
          <td style="padding:12px 0 0 0;text-align:left;font-weight:bold;font-size:20px;color:#1e3a8a;border-top:1px solid #d1d5db">Amount Received:</td>
          <td style="padding:12px 0 0 0;text-align:right;font-weight:bold;font-size:20px;color:#1e3a8a;border-top:1px solid #d1d5db">${f(invoice.total)}</td>
        </tr>
      </table>
    </td>
  </tr>
</table>

<div style="background:#eff6ff;border-left:4px solid #3b82f6;padding:12px;margin:20px 0">
<p style="margin:0;font-size:13px;color:#1e40af">💡 The invoice status has been updated to "Paid" in your system.</p>
</div>

</div>

<div style="text-align:center;padding:15px;background:#1e3a8a;color:white">
<p style="margin:0 0 5px 0;font-size:12px">Service provided by</p>
<p style="margin:0">© 2024 Thunder Pro Inc. | <a href="https://www.thunderpro.co" style="color:white">www.thunderpro.co</a></p>
</div>

</div>
</body>
</html>`;

      console.log('Sending payment confirmation to client:', invoice.email);

      // Send confirmation email to client
      await sendEmailViaSMTP(
        invoice.email,
        companyEmail || null,
        `Payment confirmation for invoice ${invoice.invoice_number}`,
        clientConfirmationHtml
      );

      console.log('Client confirmation sent');

      // Send notification email to owner
      if (companyEmail) {
        console.log('Sending payment notification to owner:', companyEmail);

        await sendEmailViaSMTP(
          companyEmail,
          null,
          `${invoice.client_name} paid invoice ${invoice.invoice_number}`,
          ownerNotificationHtml
        );

        console.log('Owner notification sent');
      }

      return new Response(
        JSON.stringify({ success: true, message: 'Payment processed and confirmation emails sent' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );

    } catch (error: any) {
      Sentry.captureException(error);
      console.error('Error in process-invoice-payment:', error);
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
  });
});
