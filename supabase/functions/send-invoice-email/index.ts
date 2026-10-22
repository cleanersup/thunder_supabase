import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as Sentry from "npm:@sentry/deno";
import { resolvePublicSupabaseUrl } from "../_shared/resolvePublicSupabaseUrl.ts";
import { resolvePublicAppUrl } from "../_shared/resolvePublicAppUrl.ts";
import { resolveInvoicePdfUrl } from "../_shared/resolveQuickQuoteViewUrl.ts";
import { formatDateOnlyLong } from "../_shared/formatDateOnly.ts";
import { formatPhoneDisplay, formatStreetAddress, personFirstName } from "../_shared/documentEmailCard.ts";
import { renderInvoiceEmail } from "../_shared/invoiceEmailCard.ts";

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
  /** Payment received: send thank-you to client + alert to merchant (not the “pay now” invoice email). */
  isPaymentConfirmation?: boolean;
}

// SMTP email sending function
async function sendEmailViaSMTP(
  toEmail: string,
  bccEmail: string | null,
  subject: string,
  htmlContent: string,
  replyToEmail: string | null = null
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
      ...(replyToEmail ? [`Reply-To: ${replyToEmail}`] : []),
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
      const { invoiceId, isUpdate, isPaymentConfirmation }: InvoiceEmailRequest = await req.json();
      console.log('Processing invoice email for:', invoiceId, 'isUpdate:', isUpdate, 'isPaymentConfirmation:', isPaymentConfirmation);

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
        .select('first_name, last_name, company_name, company_email, company_phone, company_address, company_apt_suite, company_city, company_state, company_zip, timezone')
        .eq('user_id', invoice.user_id)
        .single();

      if (profileError || !profile) {
        throw new Error('Company profile not found');
      }

      const companyName = profile.company_name || 'Our Company';
      let ownerEmail: string | null = profile.company_email ?? null;
      const userTimezone = profile.timezone || 'America/New_York';
      const ownerName = [profile.first_name, profile.last_name].filter(Boolean).join(' ').trim();

      if (!ownerEmail) {
        const { data: authData } = await supabase.auth.admin.getUserById(invoice.user_id);
        ownerEmail = authData.user?.email ?? null;
      }

      const formatDateInTimezone = (dateStr: string, timezone: string): string =>
        formatDateOnlyLong(dateStr, timezone);

      const invoiceDateFormatted = formatDateInTimezone(invoice.invoice_date, userTimezone);
      const dueDateFormatted = formatDateInTimezone(invoice.due_date, userTimezone);
      const clientFirst = personFirstName(invoice.client_name);
      const clientContact = {
        name: String(invoice.client_name || ''),
        email: String(invoice.email || ''),
        phone: formatPhoneDisplay(invoice.phone),
        address: formatStreetAddress([
          invoice.address,
          invoice.apt,
          invoice.city,
          invoice.state,
          invoice.zip,
        ]),
      };
      const ownerContact = {
        name: ownerName || companyName,
        email: String(ownerEmail || profile.company_email || ''),
        phone: formatPhoneDisplay(profile.company_phone),
        address: formatStreetAddress([
          profile.company_address,
          profile.company_apt_suite,
          profile.company_city,
          profile.company_state,
          profile.company_zip,
        ]),
      };
      const pdfUrl = resolveInvoicePdfUrl(invoice.payment_token || invoice.id);
      const cardBase = {
        companyName,
        clientFirstName: clientFirst,
        invoiceNumber: String(invoice.invoice_number || ''),
        invoiceDate: invoiceDateFormatted === 'N/A' ? '' : invoiceDateFormatted,
        dueDate: dueDateFormatted === 'N/A' ? '' : dueDateFormatted,
        serviceType: String(invoice.service_type || ''),
        pdfUrl,
      };

      // Paid confirmation (client + owner). Stripe and manual payment call this with isPaymentConfirmation.
      if (isPaymentConfirmation) {
        const clientPaidHtml = renderInvoiceEmail({
          ...cardBase,
          audience: 'client',
          moment: 'paid',
          greetingName: clientFirst,
          contact: ownerContact,
          payUrl: null,
        });
        const ownerPaidHtml = renderInvoiceEmail({
          ...cardBase,
          audience: 'owner',
          moment: 'paid',
          greetingName: personFirstName(ownerName),
          contact: clientContact,
          payUrl: null,
        });

        console.log("Sending payment confirmation to client:", invoice.email);
        await sendEmailViaSMTP(
          invoice.email,
          null,
          `Payment received — Invoice ${invoice.invoice_number}`,
          clientPaidHtml,
          ownerEmail,
        );

        if (ownerEmail) {
          console.log("Sending payment confirmation to merchant:", ownerEmail);
          await sendEmailViaSMTP(
            ownerEmail,
            null,
            `Invoice paid: ${invoice.invoice_number} — ${invoice.client_name}`,
            ownerPaidHtml,
            ownerEmail,
          );
        } else {
          console.warn("No merchant email (company_email or auth email); skipping owner payment confirmation");
        }

        return new Response(
          JSON.stringify({ success: true, message: "Payment confirmation emails sent" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // Pay stays on the payment page. Download opens the invoice PDF.
      const publicAppUrlEnv = Deno.env.get('PUBLIC_APP_URL');
      const appUrlEnv = Deno.env.get('APP_URL');
      const supabaseUrlEnv = Deno.env.get('SUPABASE_URL');

      console.log('=== Payment Link Debug ===');
      console.log('PUBLIC_APP_URL from env:', publicAppUrlEnv || 'NOT SET');
      console.log('APP_URL from env:', appUrlEnv || 'NOT SET');
      console.log('SUPABASE_URL from env:', supabaseUrlEnv || 'NOT SET');

      const publicAppUrl = resolvePublicAppUrl();
      const paymentLink = `${publicAppUrl}/invoice/payment/${invoice.payment_token || invoiceId}`;
      const publicSupabaseUrl = resolvePublicSupabaseUrl();

      console.log('Selected publicAppUrl:', publicAppUrl);
      console.log('Public Supabase URL for invoice email links:', publicSupabaseUrl);
      console.log('Generated paymentLink:', paymentLink);
      console.log('=== End Payment Link Debug ===');

      const trackingPixelUrl = `${publicSupabaseUrl}/functions/v1/mark-viewed?type=invoice&id=${invoiceId}`;
      const clientEmailHtml = renderInvoiceEmail({
        ...cardBase,
        audience: 'client',
        moment: 'sent',
        greetingName: clientFirst,
        contact: ownerContact,
        payUrl: paymentLink,
        trackingPixelUrl,
        isUpdate,
      });
      const ownerEmailHtml = renderInvoiceEmail({
        ...cardBase,
        audience: 'owner',
        moment: 'sent',
        greetingName: personFirstName(ownerName),
        contact: clientContact,
        payUrl: null,
        isUpdate,
      });


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
        clientEmailHtml,
        ownerEmail
      );

      console.log('Client email sent successfully');

      // Send confirmation email to owner
      if (ownerEmail) {
        console.log('Sending owner notification to:', ownerEmail);

        await sendEmailViaSMTP(
          ownerEmail,
          null,
          ownerSubject,
          ownerEmailHtml,
          ownerEmail
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
