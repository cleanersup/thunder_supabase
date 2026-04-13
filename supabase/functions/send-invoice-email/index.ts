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

interface InvoiceEmailRequest {
  invoiceId: string;
  isUpdate?: boolean;
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
      `X-Mailer: ThunderPro-Invoices`,
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
    Sentry.setTag("function", "send-invoice-email");

    if (req.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      const { invoiceId, isUpdate }: InvoiceEmailRequest = await req.json();
      console.log('Processing invoice email for:', invoiceId, 'isUpdate:', isUpdate);

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

      // Fetch company profile
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('company_name, company_email, company_phone, company_logo, timezone')
        .eq('user_id', invoice.user_id)
        .single();

      if (profileError || !profile) {
        throw new Error('Company profile not found');
      }

      const companyName = profile.company_name || 'Our Company';
      const companyEmail = profile.company_email;
      const companyLogo = profile.company_logo;
      const userTimezone = profile.timezone || 'America/New_York';

      // Helper function to format dates in user's timezone
      // FIX: invoice_date and due_date are stored as DATE (YYYY-MM-DD) without timezone info
      // Problem: new Date("2024-12-26") is interpreted as UTC midnight (2024-12-26T00:00:00Z)
      // When formatted in timezone like "America/New_York" (UTC-5), it becomes 2024-12-25T19:00:00 (previous day)
      // Solution: Parse date components and create date at midday in UTC to avoid day shift
      const formatDateInTimezone = (dateStr: string, timezone: string): string => {
        if (!dateStr) return 'N/A';
        try {
          // Parse date string (YYYY-MM-DD format from database)
          const [year, month, day] = dateStr.split('-').map(Number);

          // Create date at midday (12:00) UTC to avoid timezone edge cases
          // This ensures the date stays correct regardless of timezone offset
          const dateAtMidday = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));

          // Format in user's timezone - using midday ensures date is always correct
          return new Intl.DateTimeFormat('en-US', {
            timeZone: timezone,
            year: 'numeric',
            month: 'long',
            day: 'numeric'
          }).format(dateAtMidday);
        } catch (error) {
          console.error('Error formatting date:', error);
          return dateStr;
        }
      };

      const invoiceDateFormatted = formatDateInTimezone(invoice.invoice_date, userTimezone);
      const dueDateFormatted = formatDateInTimezone(invoice.due_date, userTimezone);

      // Prepare invoice payment link (this would be a public page where client can pay)
      const publicAppUrlEnv = Deno.env.get('PUBLIC_APP_URL');
      const appUrlEnv = Deno.env.get('APP_URL');
      const supabaseUrlEnv = Deno.env.get('SUPABASE_URL');

      console.log('=== Payment Link Debug ===');
      console.log('PUBLIC_APP_URL from env:', publicAppUrlEnv || 'NOT SET');
      console.log('APP_URL from env:', appUrlEnv || 'NOT SET');
      console.log('SUPABASE_URL from env:', supabaseUrlEnv || 'NOT SET');

      const publicAppUrl = publicAppUrlEnv || appUrlEnv || 'https://app.staging.thunderpro.co';
      // Use payment_token (opaque) instead of raw UUID to prevent URL enumeration
      const paymentLink = `${publicAppUrl}/invoice/payment/${invoice.payment_token || invoiceId}`;

      // Public Supabase URL for Edge Functions (download PDF, tracking pixel, etc.)
      // Must be publicly accessible — SUPABASE_URL may be internal (e.g. kong:8000).
      // Email clients (Outlook, Gmail) load the tracking pixel when the user opens the email;
      // they cannot reach internal URLs.
      const publicSupabaseUrl = publicAppUrlEnv || appUrlEnv || 'https://staging.thunderpro.co';

      console.log('Selected publicAppUrl:', publicAppUrl);
      console.log('Generated paymentLink:', paymentLink);
      console.log('=== End Payment Link Debug ===');

      // Generate tracking pixel URL (use public URL so email clients can reach it when user opens email)
      const trackingPixelUrl = `${publicSupabaseUrl}/functions/v1/mark-viewed?type=invoice&id=${invoiceId}`;

      // Email to Client - Gmail-compatible HTML (tables only, inline styles)
      const f = (n: number) => `$${n.toFixed(2)}`;
      const clientEmailHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background-color:#f5f5f5">
<table cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f5f5f5;padding:20px 0">
  <tr>
    <td align="center">
      <table cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;background-color:#ffffff">
        
        <!-- Header -->
        <tr>
          <td align="center" style="background-color:#1e3a8a;padding:15px;color:#ffffff">
            <h1 style="margin:0;padding:0;font-size:22px;color:#ffffff">${companyName}</h1>
            <p style="margin:5px 0 0 0;padding:0;font-size:14px;color:#ffffff">Professional Cleaning Invoice</p>
          </td>
        </tr>
        
        <!-- Content -->
        <tr>
          <td style="padding:20px">
            
            <!-- Client Information -->
            <table cellpadding="0" cellspacing="0" border="0" width="100%">
              <tr>
                <td>
                  <h3 style="margin:0 0 8px 0;padding:0;color:#1e3a8a;font-size:16px">Client Information</h3>
                  <div style="border-top:2px solid #1e3a8a;margin-bottom:12px"></div>
                  <p style="margin:0;padding:0;line-height:1.6;color:#333333">
                    <strong>Name:</strong> ${invoice.client_name}<br>
                    <strong>Email:</strong> ${invoice.email}<br>
                    <strong>Phone:</strong> ${invoice.phone}<br>
                    <strong>Address:</strong> ${invoice.address}${invoice.apt ? `, ${invoice.apt}` : ''}, ${invoice.city}, ${invoice.state} ${invoice.zip}
                  </p>
                </td>
              </tr>
            </table>
            
            <!-- Invoice Details -->
            <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:20px">
              <tr>
                <td>
                  <h3 style="margin:0 0 8px 0;padding:0;color:#1e3a8a;font-size:16px">Invoice Details</h3>
                  <div style="border-top:2px solid #1e3a8a;margin-bottom:12px"></div>
                  <p style="margin:0;padding:0;line-height:1.6;color:#333333">
                    <strong>Invoice Number:</strong> ${invoice.invoice_number}<br>
                    <strong>Invoice Date:</strong> ${invoiceDateFormatted}<br>
                    <strong>Due Date:</strong> ${dueDateFormatted}<br>
                    <strong>Service Type:</strong> ${invoice.service_type}
                  </p>
                </td>
              </tr>
            </table>
            
            ${invoice.line_items && invoice.line_items.length > 0 ? `
            <!-- Line Items -->
            <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:20px">
              <tr>
                <td>
                  <h3 style="margin:0 0 8px 0;padding:0;color:#1e3a8a;font-size:16px">Line Items</h3>
                  <div style="border-top:2px solid #1e3a8a;margin-bottom:12px"></div>
                  <table cellpadding="8" cellspacing="0" border="0" width="100%" style="border:1px solid #e5e7eb">
                    <thead>
                      <tr style="background-color:#f9fafb">
                        <th style="text-align:left;padding:10px;font-size:12px;font-weight:600;color:#374151;border-bottom:1px solid #e5e7eb">Description</th>
                        <th style="text-align:center;padding:10px;font-size:12px;font-weight:600;color:#374151;border-bottom:1px solid #e5e7eb">Price</th>
                        <th style="text-align:center;padding:10px;font-size:12px;font-weight:600;color:#374151;border-bottom:1px solid #e5e7eb">Qty</th>
                        <th style="text-align:right;padding:10px;font-size:12px;font-weight:600;color:#374151;border-bottom:1px solid #e5e7eb">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${invoice.line_items.map((item: any, index: number) => `
                      <tr${index % 2 === 1 ? ' style="background-color:#f9fafb"' : ''}>
                        <td style="padding:10px;font-size:13px;color:#333333;border-bottom:1px solid #e5e7eb">${item.description || '-'}</td>
                        <td style="text-align:center;padding:10px;font-size:13px;color:#333333;border-bottom:1px solid #e5e7eb">${f(parseFloat(item.price) || 0)}</td>
                        <td style="text-align:center;padding:10px;font-size:13px;color:#333333;border-bottom:1px solid #e5e7eb">${item.qty || 1}</td>
                        <td style="text-align:right;padding:10px;font-size:13px;font-weight:600;color:#333333;border-bottom:1px solid #e5e7eb">${f(item.total || 0)}</td>
                      </tr>
                      `).join('')}
                    </tbody>
                  </table>
                </td>
              </tr>
            </table>
            ` : ''}
            
            ${invoice.notes ? `
            <!-- Notes -->
            <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:20px">
              <tr>
                <td>
                  <h3 style="margin:0 0 8px 0;padding:0;color:#1e3a8a;font-size:16px">Notes</h3>
                  <div style="border-top:2px solid #1e3a8a;margin-bottom:12px"></div>
                  <p style="margin:0;padding:0;line-height:1.6;color:#333333">${invoice.notes}</p>
                </td>
              </tr>
            </table>
            ` : ''}
            
            <!-- Amount Due -->
            <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:20px">
              <tr>
                <td>
                  <h3 style="margin:0 0 8px 0;padding:0;color:#1e3a8a;font-size:16px">Amount Due</h3>
                </td>
              </tr>
              <tr>
                <td>
                  <table cellpadding="16" cellspacing="0" border="0" width="100%" style="background-color:#f0fdf4">
                    <tr>
                      <td style="text-align:left;font-weight:bold;font-size:20px;color:#1e3a8a">Total Amount Due:</td>
                      <td style="text-align:right;font-weight:bold;font-size:20px;color:#1e3a8a">${f(invoice.total)}</td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
            
            <!-- Action Buttons -->
            <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:30px">
              <tr>
                <td align="center">
                  <a href="${paymentLink}" style="display:inline-block;background-color:#10b981;color:#ffffff;padding:15px 40px;text-decoration:none;border-radius:5px;font-weight:bold;margin:5px">Pay Invoice</a>
                  <a href="${publicSupabaseUrl}/functions/v1/download-invoice-pdf?id=${invoiceId}" style="display:inline-block;background-color:#1e3a8a;color:#ffffff;padding:15px 40px;text-decoration:none;border-radius:5px;font-weight:bold;margin:5px">Download PDF</a>
                </td>
              </tr>
            </table>
            
          </td>
        </tr>
        
        <!-- Footer -->
        <tr>
          <td align="center" style="background-color:#1e3a8a;padding:15px;color:#ffffff">
            <p style="margin:0 0 5px 0;padding:0;font-size:12px;color:#ffffff">Service provided by</p>
            <p style="margin:0;padding:0;font-size:12px;color:#ffffff">© 2024 Thunder Pro Inc. | <a href="https://www.thunderpro.co" style="color:#ffffff;text-decoration:underline">www.thunderpro.co</a></p>
          </td>
        </tr>
        
      </table>
    </td>
  </tr>
</table>

<!-- Tracking pixel -->
<img src="${trackingPixelUrl}" width="1" height="1" style="display:none" alt="" />

</body>
</html>`;

      // Email to Owner - Gmail-compatible HTML (tables only, inline styles)
      const ownerEmailHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background-color:#f5f5f5">
<table cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f5f5f5;padding:20px 0">
  <tr>
    <td align="center">
      <table cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;background-color:#ffffff">
        
        <!-- Header -->
        <tr>
          <td align="center" style="background-color:#1e3a8a;padding:15px;color:#ffffff">
            <table cellpadding="8" cellspacing="0" border="0" width="100%">
              <tr>
                <td align="center" style="background-color:#1e40af;border-radius:4px">
                  <p style="margin:0;padding:0;font-size:14px;font-weight:bold;color:#ffffff">OWNER COPY - INTERNAL USE ONLY</p>
                </td>
              </tr>
            </table>
            <h1 style="margin:10px 0 0 0;padding:0;font-size:22px;color:#ffffff">${companyName}</h1>
            <p style="margin:5px 0 0 0;padding:0;font-size:14px;color:#ffffff">Invoice Sent Confirmation</p>
          </td>
        </tr>
        
        <!-- Content -->
        <tr>
          <td style="padding:20px">
            
            <!-- Success Message -->
            <table cellpadding="12" cellspacing="0" border="0" width="100%" style="background-color:#f0fdf4;border-left:4px solid #10b981;margin-bottom:15px">
              <tr>
                <td>
                  <p style="margin:0 0 5px 0;padding:0;font-weight:bold;color:#059669">Invoice Successfully Sent</p>
                  <p style="margin:0;padding:0;font-size:13px;color:#333333">An invoice has been sent to ${invoice.client_name}</p>
                </td>
              </tr>
            </table>
            
            <!-- Client Information -->
            <table cellpadding="0" cellspacing="0" border="0" width="100%">
              <tr>
                <td>
                  <h3 style="margin:0 0 8px 0;padding:0;color:#1e3a8a;font-size:16px">Client Information</h3>
                  <div style="border-top:2px solid #1e3a8a;margin-bottom:12px"></div>
                  <p style="margin:0;padding:0;line-height:1.6;color:#333333">
                    <strong>Name:</strong> ${invoice.client_name}<br>
                    <strong>Email:</strong> ${invoice.email}<br>
                    <strong>Phone:</strong> ${invoice.phone}<br>
                    <strong>Address:</strong> ${invoice.address}${invoice.apt ? `, ${invoice.apt}` : ''}, ${invoice.city}, ${invoice.state} ${invoice.zip}
                  </p>
                </td>
              </tr>
            </table>
            
            <!-- Invoice Details -->
            <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:20px">
              <tr>
                <td>
                  <h3 style="margin:0 0 8px 0;padding:0;color:#1e3a8a;font-size:16px">Invoice Details</h3>
                  <div style="border-top:2px solid #1e3a8a;margin-bottom:12px"></div>
                  <p style="margin:0;padding:0;line-height:1.6;color:#333333">
                    <strong>Invoice Number:</strong> ${invoice.invoice_number}<br>
                    <strong>Invoice Date:</strong> ${invoiceDateFormatted}<br>
                    <strong>Due Date:</strong> ${dueDateFormatted}<br>
                    <strong>Service Type:</strong> ${invoice.service_type}
                  </p>
                </td>
              </tr>
            </table>
            
            ${invoice.line_items && invoice.line_items.length > 0 ? `
            <!-- Line Items -->
            <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:20px">
              <tr>
                <td>
                  <h3 style="margin:0 0 8px 0;padding:0;color:#1e3a8a;font-size:16px">Line Items</h3>
                  <div style="border-top:2px solid #1e3a8a;margin-bottom:12px"></div>
                  <table cellpadding="8" cellspacing="0" border="0" width="100%" style="border:1px solid #e5e7eb">
                    <thead>
                      <tr style="background-color:#f9fafb">
                        <th style="text-align:left;padding:10px;font-size:12px;font-weight:600;color:#374151;border-bottom:1px solid #e5e7eb">Description</th>
                        <th style="text-align:center;padding:10px;font-size:12px;font-weight:600;color:#374151;border-bottom:1px solid #e5e7eb">Price</th>
                        <th style="text-align:center;padding:10px;font-size:12px;font-weight:600;color:#374151;border-bottom:1px solid #e5e7eb">Qty</th>
                        <th style="text-align:right;padding:10px;font-size:12px;font-weight:600;color:#374151;border-bottom:1px solid #e5e7eb">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${invoice.line_items.map((item: any, index: number) => `
                      <tr${index % 2 === 1 ? ' style="background-color:#f9fafb"' : ''}>
                        <td style="padding:10px;font-size:13px;color:#333333;border-bottom:1px solid #e5e7eb">${item.description || '-'}</td>
                        <td style="text-align:center;padding:10px;font-size:13px;color:#333333;border-bottom:1px solid #e5e7eb">${f(parseFloat(item.price) || 0)}</td>
                        <td style="text-align:center;padding:10px;font-size:13px;color:#333333;border-bottom:1px solid #e5e7eb">${item.qty || 1}</td>
                        <td style="text-align:right;padding:10px;font-size:13px;font-weight:600;color:#333333;border-bottom:1px solid #e5e7eb">${f(item.total || 0)}</td>
                      </tr>
                      `).join('')}
                    </tbody>
                  </table>
                </td>
              </tr>
            </table>
            ` : ''}
            
            <!-- Amount -->
            <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:20px">
              <tr>
                <td>
                  <h3 style="margin:0 0 8px 0;padding:0;color:#1e3a8a;font-size:16px">Amount</h3>
                </td>
              </tr>
              <tr>
                <td>
                  <table cellpadding="16" cellspacing="0" border="0" width="100%" style="background-color:#f0fdf4">
                    <tr>
                      <td style="text-align:left;font-weight:bold;font-size:20px;color:#1e3a8a">Total:</td>
                      <td style="text-align:right;font-weight:bold;font-size:20px;color:#1e3a8a">${f(invoice.total)}</td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
            
            <!-- Download PDF Button for Owner -->
            <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:20px">
              <tr>
                <td align="center">
                  <a href="${publicSupabaseUrl}/functions/v1/download-invoice-pdf?id=${invoiceId}" style="display:inline-block;background-color:#1e3a8a;color:#ffffff;padding:15px 40px;text-decoration:none;border-radius:5px;font-weight:bold">Download PDF</a>
                </td>
              </tr>
            </table>
            
            <!-- Info Box -->
            <table cellpadding="12" cellspacing="0" border="0" width="100%" style="margin-top:20px;background-color:#eff6ff;border-left:4px solid #3b82f6">
              <tr>
                <td>
                  <p style="margin:0;padding:0;font-size:13px;color:#1e40af">💡 The client can pay online using the payment link sent in their email.</p>
                </td>
              </tr>
            </table>
            
          </td>
        </tr>
        
        <!-- Footer -->
        <tr>
          <td align="center" style="background-color:#1e3a8a;padding:15px;color:#ffffff">
            <p style="margin:0 0 5px 0;padding:0;font-size:12px;color:#ffffff">Service provided by</p>
            <p style="margin:0;padding:0;font-size:12px;color:#ffffff">© 2024 Thunder Pro Inc. | <a href="https://www.thunderpro.co" style="color:#ffffff;text-decoration:underline">www.thunderpro.co</a></p>
          </td>
        </tr>
        
      </table>
    </td>
  </tr>
</table>

</body>
</html>`;

      console.log('Sending client invoice email to:', invoice.email);

      // Determine email subjects based on whether this is an update
      const clientSubject = isUpdate
        ? `You have an Updated invoice - ${companyName}`
        : `${companyName} sent you an invoice`;
      const ownerSubject = isUpdate
        ? `Invoice updated for ${invoice.client_name}`
        : `Invoice sent to ${invoice.client_name}`;

      // Send email to client (no BCC to avoid duplicate emails to owner)
      await sendEmailViaSMTP(
        invoice.email,
        null,
        clientSubject,
        clientEmailHtml
      );

      console.log('Client email sent successfully');

      // Send confirmation email to owner
      if (companyEmail) {
        console.log('Sending owner notification to:', companyEmail);

        await sendEmailViaSMTP(
          companyEmail,
          null,
          ownerSubject,
          ownerEmailHtml
        );

        console.log('Owner email sent successfully');
      }

      return new Response(
        JSON.stringify({ success: true, message: 'Invoice emails sent successfully' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );

    } catch (error: any) {
      Sentry.captureException(error);
      console.error('Error in send-invoice-email:', error);
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
  });
});
