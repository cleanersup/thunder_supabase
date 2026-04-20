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

  console.log('Configuration:', {
    smtpHost,
    smtpPort,
    fromEmail,
    toEmail,
    bccEmail,
    subject
  });

  let conn: Deno.TcpConn | null = null;
  let tlsConn: Deno.TlsConn | null = null;

  try {
    console.log('[1/10] Connecting to SMTP server:', `${smtpHost}:${smtpPort}...`);
    conn = await Deno.connect({ hostname: smtpHost, port: smtpPort });
    console.log('[1/10] ✓ TCP connection established');

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
      const displayCommand = maskInLog ? command.substring(0, 15) + '...' : command;

      console.log(`${stepName} Sending: ${displayCommand}`);
      await connection.write(encoder.encode(command + '\r\n'));

      const response = await readResponse(connection);
      console.log(`${stepName} Response: ${response.trim()}`);

      const responseCode = response.substring(0, 3);
      if (responseCode.startsWith('4') || responseCode.startsWith('5')) {
        throw new Error(`SMTP Error ${responseCode}: ${response.trim()}`);
      }

      return response;
    };

    console.log('[2/10] Reading server greeting...');
    const greeting = await readResponse(conn);
    console.log('[2/10] ✓ Server greeting:', greeting.trim());

    await sendCommand(conn, 'EHLO thunderpro.co', '[3/10]');
    await sendCommand(conn, 'STARTTLS', '[4/10]');

    console.log('[5/10] Upgrading to TLS...');
    tlsConn = await Deno.startTls(conn, { hostname: smtpHost });
    console.log('[5/10] ✓ TLS established');

    await sendCommand(tlsConn, 'EHLO thunderpro.co', '[6/10]');

    console.log('[7/10] Sending: AUTH LOGIN...');
    await tlsConn.write(encoder.encode('AUTH LOGIN\r\n'));
    await readResponse(tlsConn);
    console.log('[7/10] Response: 334 VXNlcm5hbWU6');

    await sendCommand(tlsConn, btoa(smtpUser), '[7/10]', true);
    await sendCommand(tlsConn, btoa(smtpPass), '[7/10]', true);
    console.log('[7/10] ✓ Authentication successful');

    await sendCommand(tlsConn, `MAIL FROM:<info@thunderpro.co>`, '[8/10]');
    await sendCommand(tlsConn, `RCPT TO:<${toEmail}>`, '[8/10]');
    console.log('[8/10] Response: 250 Ok');

    if (bccEmail && bccEmail !== toEmail) {
      await sendCommand(tlsConn, `RCPT TO:<${bccEmail}>`, '[8/10]');
      console.log('[8/10] ✓ BCC recipient added');
    }

    await sendCommand(tlsConn, 'DATA', '[9/10]');

    console.log('[9/10] Sending email headers...');

    const timestamp = Date.now();
    const randomId = Math.random().toString(36).substring(2, 15);
    const messageId = `<${timestamp}.${randomId}@thunderpro.co>`;
    const uniqueRef = `${timestamp}-${randomId}`;

    const headers = [
      `From: ${fromEmail}`,
      `To: ${toEmail}`,
      `Subject: ${subject}`,
      `Message-ID: ${messageId}`,
      `X-Entity-Ref-ID: ${uniqueRef}`,
      `X-Mailer: ThunderPro-Invoices-Reminder`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=UTF-8',
      '',
    ].join('\r\n');

    await tlsConn.write(encoder.encode(headers + '\r\n'));

    console.log('[9/10] Sending email body in chunks...');
    const chunkSize = 4096;
    const contentBytes = encoder.encode(htmlContent);

    for (let i = 0; i < contentBytes.length; i += chunkSize) {
      const chunk = contentBytes.slice(i, Math.min(i + chunkSize, contentBytes.length));
      await tlsConn.write(chunk);
    }

    await tlsConn.write(encoder.encode('\r\n.\r\n'));

    const dataResponse = await readResponse(tlsConn);
    console.log('[9/10] ✓ Email sent:', dataResponse.trim());

    await sendCommand(tlsConn, 'QUIT', '[10/10]');
    tlsConn.close();
    console.log('=== Email sent successfully ===');

  } catch (error: any) {
    console.error('=== SMTP Error ===');
    console.error('Error:', error.message);

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
    Sentry.setTag("function", "send-invoice-reminders");

    if (req.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // Parse request body for optional invoiceId
      const body = await req.json().catch(() => ({}));
      const invoiceId = body.invoiceId;

      console.log('=== Starting Invoice Reminders Job ===');
      console.log('Current time:', new Date().toISOString());
      if (invoiceId) {
        console.log('Processing specific invoice:', invoiceId);
      }

      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const supabase = createClient(supabaseUrl, supabaseKey);

      let overdueInvoices;

      // If invoiceId is provided, fetch that specific invoice
      if (invoiceId) {
        const { data: invoice, error: invoiceError } = await supabase
          .from('invoices')
          .select('*')
          .eq('id', invoiceId)
          .neq('status', 'Paid')
          .maybeSingle();

        if (invoiceError) {
          console.error('Error fetching invoice:', invoiceError);
          throw invoiceError;
        }

        if (!invoice) {
          return new Response(
            JSON.stringify({
              success: false,
              message: 'Invoice not found or already paid',
              count: 0
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        overdueInvoices = [invoice];
        console.log(`Found invoice ${invoice.invoice_number} for ${invoice.client_name}`);
      } else {
        // Batch mode: Get today's date in YYYY-MM-DD format
        const today = new Date().toISOString().split('T')[0];
        console.log('Checking for invoices due exactly on:', today);

        // Find all unpaid invoices where due_date is EXACTLY today AND reminder not sent yet
        const { data, error: invoicesError } = await supabase
          .from('invoices')
          .select('*')
          .neq('status', 'Paid')
          .eq('due_date', today)
          .eq('reminder_sent', false);

        if (invoicesError) {
          console.error('Error fetching overdue invoices:', invoicesError);
          throw invoicesError;
        }

        overdueInvoices = data || [];
        console.log(`Found ${overdueInvoices.length} invoices due today`);
      }

      if (!overdueInvoices || overdueInvoices.length === 0) {
        return new Response(
          JSON.stringify({
            success: true,
            message: invoiceId ? 'Invoice not found or already paid' : 'No invoices due today',
            count: 0
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      let sentCount = 0;
      let errorCount = 0;

      // Process each overdue invoice
      for (const invoice of overdueInvoices) {
        try {
          console.log(`Processing invoice ${invoice.invoice_number} for ${invoice.client_name}`);

          // Fetch company profile
          const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('company_name, company_email, company_phone, company_logo, timezone')
            .eq('user_id', invoice.user_id)
            .single();

          if (profileError || !profile) {
            console.error(`Error fetching profile for invoice ${invoice.invoice_number}:`, profileError);
            errorCount++;
            continue;
          }

          const companyName = profile.company_name || 'Our Company';
          const companyEmail = profile.company_email;
          const userTimezone = profile.timezone || 'America/New_York';

          // Helper function to format dates in user's timezone
          const formatDateInTimezone = (dateStr: string, timezone: string): string => {
            const date = new Date(dateStr);
            return new Intl.DateTimeFormat('en-US', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
              timeZone: timezone
            }).format(date);
          };

          const invoiceDateFormatted = formatDateInTimezone(invoice.invoice_date, userTimezone);
          const dueDateFormatted = formatDateInTimezone(invoice.due_date, userTimezone);

          // Since we're only checking for due_date = today, this is a due date reminder
          const dueDateNotice = `<div style="background:#fef3c7;border-left:4px solid #f59e0b;padding:12px;margin:20px 0">
          <p style="margin:0;font-weight:bold;color:#d97706">⏰ Payment Due Today</p>
          <p style="margin:5px 0 0 0;font-size:13px;color:#d97706">This invoice is due today. Please submit payment to avoid late fees.</p>
        </div>`;

          const publicAppUrlEnv = Deno.env.get('PUBLIC_APP_URL');
          const appUrlEnv = Deno.env.get('APP_URL');
          const supabaseUrlEnv = Deno.env.get('SUPABASE_URL');

          console.log(`=== Payment Link Debug (Invoice ${invoice.invoice_number}) ===`);
          console.log('PUBLIC_APP_URL from env:', publicAppUrlEnv || 'NOT SET');
          console.log('APP_URL from env:', appUrlEnv || 'NOT SET');
          console.log('SUPABASE_URL from env:', supabaseUrlEnv || 'NOT SET');

          const publicAppUrl = publicAppUrlEnv || appUrlEnv || 'https://app.staging.thunderpro.co';
          // Use payment_token (opaque) instead of raw UUID to prevent URL enumeration
          const paymentLink = `${publicAppUrl}/invoice/payment/${invoice.payment_token || invoice.id}`;

          // Public URL for tracking pixel — must be reachable by email clients (Outlook, Gmail) when user opens email
          const publicSupabaseUrl = publicAppUrlEnv || appUrlEnv || 'https://staging.thunderpro.co';

          console.log('Selected publicAppUrl:', publicAppUrl);
          console.log('Generated paymentLink:', paymentLink);
          console.log('=== End Payment Link Debug ===');

          const f = (n: number) => `$${n.toFixed(2)}`;

          // Email template for CLIENT (with Pay Now button)
          const clientReminderEmailHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
@media only screen and (max-width: 600px) {
  .email-container {
    max-width: 100% !important;
  }
  .email-body {
    padding: 10px !important;
  }
  .email-content {
    padding: 10px !important;
  }
}
</style>
</head>
<body style="margin:0;padding:20px;font-family:Arial,sans-serif">
<div class="email-container" style="max-width:600px;margin:0 auto">

<div class="email-body" style="text-align:center;padding:15px;background:#1e3a8a;color:white">
<h1 style="margin:0;font-size:22px">${companyName}</h1>
<p style="margin:5px 0">Payment Reminder</p>
</div>

<div class="email-content" style="padding:15px">

${dueDateNotice}

<p>Hello ${invoice.client_name},</p>
<p>This is a friendly reminder that your invoice from <strong>${companyName}</strong> is due today.</p>

<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Invoice Details</h3>
<div style="border-top:1px solid #1e3a8a;margin-bottom:12px"></div>
<p><strong>Invoice Number:</strong> ${invoice.invoice_number}<br>
<strong>Invoice Date:</strong> ${invoiceDateFormatted}<br>
<strong>Due Date:</strong> ${dueDateFormatted}<br>
<strong>Service Type:</strong> ${invoice.service_type}</p>

${invoice.notes ? `<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Notes</h3><div style="border-top:1px solid #1e3a8a;margin-bottom:12px"></div><p>${invoice.notes}</p>` : ''}

<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Amount Due</h3>
<table cellpadding="0" cellspacing="0" style="width:100%;background-color:#f0fdf4">
  <tr>
    <td style="padding:16px">
      <table cellpadding="0" cellspacing="0" style="width:100%">
        <tr>
          <td style="padding:12px 0 0 0;text-align:left;font-weight:bold;font-size:20px;color:#1e3a8a">Total Amount Due:</td>
          <td style="padding:12px 0 0 0;text-align:right;font-weight:bold;font-size:20px;color:#1e3a8a">${f(invoice.total)}</td>
        </tr>
      </table>
    </td>
  </tr>
</table>

<div style="text-align:center;margin:30px 0">
<a href="${paymentLink}" style="display:inline-block;background:#10b981;color:white;padding:15px 40px;text-decoration:none;border-radius:5px;font-weight:bold;margin:10px">Pay Now</a>
</div>

<div style="background:#eff6ff;border-left:4px solid #3b82f6;padding:12px;margin:20px 0">
<p style="margin:0;font-size:13px;color:#1e40af">💡 If you have already submitted payment, please disregard this reminder.</p>
</div>

<p style="margin-top:20px;font-size:14px;">If you have any questions, please contact us at ${companyName}.</p>

</div>

<div style="text-align:center;padding:15px;background:#1e3a8a;color:white">
<p style="margin:0 0 5px 0;font-size:12px">Service provided by</p>
<p style="margin:0">© 2024 Thunder Pro Inc. | <a href="https://www.thunderpro.co" style="color:white">www.thunderpro.co</a></p>
</div>

</div>
<img src="${publicSupabaseUrl}/functions/v1/mark-viewed?type=invoice&id=${invoice.id}" width="1" height="1" style="display:none" alt="" />
</body>
</html>`;

          // Email template for OWNER (same design as client, NO Pay Now button)
          const ownerNotificationEmailHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
@media only screen and (max-width: 600px) {
  .email-container {
    max-width: 100% !important;
  }
  .email-body {
    padding: 10px !important;
  }
  .email-content {
    padding: 10px !important;
  }
}
</style>
</head>
<body style="margin:0;padding:20px;font-family:Arial,sans-serif">
<div class="email-container" style="max-width:600px;margin:0 auto">

<div class="email-body" style="text-align:center;padding:15px;background:#1e3a8a;color:white">
<h1 style="margin:0;font-size:22px">${companyName}</h1>
<p style="margin:5px 0">Payment Reminder Sent</p>
</div>

<div class="email-content" style="padding:15px">

<div style="background:#d1fae5;border-left:4px solid #10b981;padding:12px;margin:20px 0">
<p style="margin:0;font-weight:bold;color:#047857">✓ Reminder Sent to Client</p>
<p style="margin:5px 0 0 0;font-size:13px;color:#047857">A payment reminder was automatically sent to ${invoice.client_name}</p>
</div>

<p>Hello,</p>
<p>A payment reminder was sent to <strong>${invoice.client_name}</strong> for the following invoice:</p>

<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Invoice Details</h3>
<div style="border-top:1px solid #1e3a8a;margin-bottom:12px"></div>
<p><strong>Invoice Number:</strong> ${invoice.invoice_number}<br>
<strong>Client:</strong> ${invoice.client_name}<br>
<strong>Email:</strong> ${invoice.email}<br>
<strong>Invoice Date:</strong> ${invoiceDateFormatted}<br>
<strong>Due Date:</strong> ${dueDateFormatted}<br>
<strong>Service Type:</strong> ${invoice.service_type}</p>

${invoice.notes ? `<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Notes</h3><div style="border-top:1px solid #1e3a8a;margin-bottom:12px"></div><p>${invoice.notes}</p>` : ''}

<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Amount Due</h3>
<table cellpadding="0" cellspacing="0" style="width:100%;background-color:#f0fdf4">
  <tr>
    <td style="padding:16px">
      <table cellpadding="0" cellspacing="0" style="width:100%">
        <tr>
          <td style="padding:12px 0 0 0;text-align:left;font-weight:bold;font-size:20px;color:#1e3a8a">Total Amount Due:</td>
          <td style="padding:12px 0 0 0;text-align:right;font-weight:bold;font-size:20px;color:#1e3a8a">${f(invoice.total)}</td>
        </tr>
      </table>
    </td>
  </tr>
</table>

<div style="background:#eff6ff;border-left:4px solid #3b82f6;padding:12px;margin:20px 0">
<p style="margin:0;font-size:13px;color:#1e40af">💡 This is an automated notification. The client has received a payment reminder with a link to pay online.</p>
</div>

</div>

<div style="text-align:center;padding:15px;background:#1e3a8a;color:white">
<p style="margin:0 0 5px 0;font-size:12px">Service provided by</p>
<p style="margin:0">© 2024 Thunder Pro Inc. | <a href="https://www.thunderpro.co" style="color:white">www.thunderpro.co</a></p>
</div>

</div>
</body>
</html>`;


          const clientSubject = `${companyName} sent you a invoice reminder`;
          const ownerSubject = `A reminder invoice was sent to ${invoice.client_name}`;

          console.log(`Sending reminder to client: ${invoice.email} for invoice ${invoice.invoice_number}`);

          // Send email to CLIENT with Pay Now button
          await sendEmailViaSMTP(
            invoice.email,
            null,
            clientSubject,
            clientReminderEmailHtml
          );

          console.log(`✓ Client reminder sent successfully for invoice ${invoice.invoice_number}`);

          // Send notification email to OWNER (if company email is configured)
          if (companyEmail) {
            console.log(`Sending notification to owner: ${companyEmail}`);
            await sendEmailViaSMTP(
              companyEmail,
              null,
              ownerSubject,
              ownerNotificationEmailHtml
            );
            console.log(`✓ Owner notification sent successfully for invoice ${invoice.invoice_number}`);
          }


          // Mark reminder as sent in database
          const { error: updateError } = await supabase
            .from('invoices')
            .update({ reminder_sent: true })
            .eq('id', invoice.id);

          if (updateError) {
            console.error(`Error updating reminder_sent for invoice ${invoice.invoice_number}:`, updateError);
          } else {
            console.log(`✓ Marked reminder_sent=true for invoice ${invoice.invoice_number}`);
          }

          sentCount++;

        } catch (error: any) {
          console.error(`Error processing invoice ${invoice.invoice_number}:`, error.message);
          errorCount++;
        }
      }

      console.log('=== Invoice Reminders Job Complete ===');
      console.log(`Sent: ${sentCount}, Errors: ${errorCount}`);

      return new Response(
        JSON.stringify({
          success: true,
          message: 'Invoice reminders processed',
          sent: sentCount,
          errors: errorCount,
          total: overdueInvoices.length
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );

    } catch (error: any) {
      Sentry.captureException(error);
      console.error('Error in send-invoice-reminders:', error);
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
  });
});
