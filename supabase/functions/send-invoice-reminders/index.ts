import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as Sentry from "npm:@sentry/deno";
import { resolvePublicSupabaseUrl } from "../_shared/resolvePublicSupabaseUrl.ts";
import { resolvePublicAppUrl } from "../_shared/resolvePublicAppUrl.ts";
import { formatDateOnlyLong } from "../_shared/formatDateOnly.ts";
import { formatPhoneDisplay, formatStreetAddress, personFirstName } from "../_shared/documentEmailCard.ts";
import { renderInvoiceReminderEmail } from "../_shared/invoiceEmailCard.ts";

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
            .select('first_name, last_name, company_name, company_email, company_phone, company_address, company_apt_suite, company_city, company_state, company_zip, timezone')
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

          // Format calendar dates (YYYY-MM-DD) without timezone day shift
          const formatDateInTimezone = (dateStr: string, timezone: string): string =>
            formatDateOnlyLong(dateStr, timezone);

          const invoiceDateFormatted = formatDateInTimezone(invoice.invoice_date, userTimezone);
          const dueDateFormatted = formatDateInTimezone(invoice.due_date, userTimezone);

          const f = (n: number) => `$${Number(n).toFixed(2)}`;
          const amount = Number(invoice.total);
          const amountDue = Number.isFinite(amount) ? f(amount) : "";
          const clientFirst = personFirstName(invoice.client_name);
          const ownerName = [profile.first_name, profile.last_name].filter(Boolean).join(" ").trim();
          const clientContact = {
            name: String(invoice.client_name || ""),
            email: String(invoice.email || ""),
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
            email: String(companyEmail || ""),
            phone: formatPhoneDisplay(profile.company_phone),
            address: formatStreetAddress([
              profile.company_address,
              profile.company_apt_suite,
              profile.company_city,
              profile.company_state,
              profile.company_zip,
            ]),
          };

          const publicAppUrl = resolvePublicAppUrl();
          const paymentLink = `${publicAppUrl}/invoice/payment/${invoice.payment_token || invoice.id}`;
          const publicSupabaseUrl = resolvePublicSupabaseUrl();
          const trackingPixelUrl = `${publicSupabaseUrl}/functions/v1/mark-viewed?type=invoice&id=${invoice.id}`;
          console.log("Invoice reminder payment link:", paymentLink);

          const reminderBase = {
            companyName,
            clientName: String(invoice.client_name || ""),
            clientFirstName: clientFirst,
            invoiceNumber: String(invoice.invoice_number || ""),
            invoiceDate: invoiceDateFormatted === "N/A" ? "" : invoiceDateFormatted,
            dueDate: dueDateFormatted === "N/A" ? "" : dueDateFormatted,
            serviceType: String(invoice.service_type || ""),
            amountDue,
          };
          const clientReminder = renderInvoiceReminderEmail({
            ...reminderBase,
            audience: "client",
            greetingName: clientFirst,
            contact: ownerContact,
            payUrl: paymentLink,
            trackingPixelUrl,
          });
          const ownerReminder = renderInvoiceReminderEmail({
            ...reminderBase,
            audience: "owner",
            greetingName: personFirstName(profile.first_name),
            contact: clientContact,
            payUrl: null,
          });

          console.log(`Sending reminder to client: ${invoice.email} for invoice ${invoice.invoice_number}`);
          await sendEmailViaSMTP(
            invoice.email,
            null,
            clientReminder.subject,
            clientReminder.html,
          );
          console.log(`✓ Client reminder sent successfully for invoice ${invoice.invoice_number}`);

          if (companyEmail) {
            console.log(`Sending notification to owner: ${companyEmail}`);
            await sendEmailViaSMTP(
              companyEmail,
              null,
              ownerReminder.subject,
              ownerReminder.html,
            );
            console.log(`✓ Owner notification sent successfully for invoice ${invoice.invoice_number}`);
          }

          // Notify owner in-app (-> push) that this invoice is due today
          const { error: notifyError } = await supabase.from('notifications').insert({
            user_id: invoice.user_id,
            type: 'invoice_overdue',
            title: 'Invoice payment due',
            message: `Invoice ${invoice.invoice_number} for ${invoice.client_name} (${f(invoice.total)}) is due today.`,
            related_id: invoice.id,
            related_type: 'invoice',
          });
          if (notifyError) {
            console.error(`Error creating invoice_overdue notification for ${invoice.invoice_number}:`, notifyError);
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
