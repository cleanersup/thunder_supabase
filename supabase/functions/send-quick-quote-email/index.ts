// send-quick-quote-email
//
// Emails a quick quote to an address typed by the owner (a quick quote has no
// client record). The card matches the estimate email. A quote has no address line.
//
// Body: { quickQuoteId, recipientEmail, recipientName?, publicUrl?, isUpdate?, quoteData? }

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import * as Sentry from "npm:@sentry/deno";
import { resolvePublicSupabaseUrl } from "../_shared/resolvePublicSupabaseUrl.ts";
import { resolveDocumentPdfUrl } from "../_shared/resolveQuickQuoteViewUrl.ts";
import {
  documentCode,
  formatPhoneDisplay,
  formatStreetAddress,
  personFirstName,
  renderDocumentEmail,
} from "../_shared/documentEmailCard.ts";
import { formatDateOnlyLong } from "../_shared/formatDateOnly.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Sentry.init({
  dsn: "https://ce035a76b6157a602d88c53eab6570e4@o4509804047958016.ingest.us.sentry.io/4510552540971008",
  environment: Deno.env.get("SUPABASE_URL")?.includes("staging") ? "staging" : "production",
  tracesSampleRate: 0.1,
});

interface QuickQuoteEmailRequest {
  quickQuoteId?: string;
  quoteData?: any;
  recipientEmail: string;
  recipientName?: string;
  /** Ignored. The view button uses the same URL as the SMS link. */
  publicUrl?: string;
  isUpdate?: boolean;
}

// ─── SMTP (same transport as send-estimate-email) ─────────────────────────────

async function sendEmailViaSMTP(
  toEmail: string,
  bccEmail: string | null,
  subject: string,
  htmlContent: string,
  replyToEmail: string | null = null,
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
      maskInLog: boolean = false,
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

    await readResponse(conn);
    await sendCommand(conn, 'EHLO thunderpro.co', '[1/6]');
    await sendCommand(conn, 'STARTTLS', '[2/6]');

    tlsConn = await Deno.startTls(conn, { hostname: smtpHost });
    await sendCommand(tlsConn, 'EHLO thunderpro.co', '[3/6]');

    await tlsConn.write(encoder.encode('AUTH LOGIN\r\n'));
    await readResponse(tlsConn);
    await sendCommand(tlsConn, btoa(smtpUser), '[4/6]', true);
    await sendCommand(tlsConn, btoa(smtpPass), '[4/6]', true);

    await sendCommand(tlsConn, `MAIL FROM:<info@thunderpro.co>`, '[5/6]');
    await sendCommand(tlsConn, `RCPT TO:<${toEmail}>`, '[5/6]');

    if (bccEmail && bccEmail !== toEmail) {
      await sendCommand(tlsConn, `RCPT TO:<${bccEmail}>`, '[5/6]');
    }

    await sendCommand(tlsConn, 'DATA', '[6/6]');

    const timestamp = Date.now();
    const randomId = Math.random().toString(36).substring(2, 15);
    const headers = [
      `From: ${fromEmail}`,
      `To: ${toEmail}`,
      ...(replyToEmail ? [`Reply-To: ${replyToEmail}`] : []),
      `Subject: ${subject}`,
      `Message-ID: <${timestamp}.${randomId}@thunderpro.co>`,
      `X-Entity-Ref-ID: ${timestamp}-${randomId}`,
      `X-Mailer: ThunderPro-QuickQuotes`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=UTF-8',
      '',
    ].join('\r\n');

    await tlsConn.write(encoder.encode(headers + '\r\n'));

    const chunkSize = 4096;
    const contentBytes = encoder.encode(htmlContent);
    for (let i = 0; i < contentBytes.length; i += chunkSize) {
      await tlsConn.write(contentBytes.slice(i, Math.min(i + chunkSize, contentBytes.length)));
    }

    await tlsConn.write(encoder.encode('\r\n.\r\n'));
    await readResponse(tlsConn);

    await sendCommand(tlsConn, 'QUIT', '[6/6]');
    tlsConn.close();
    console.log('=== Email sent successfully ===');
  } catch (error: any) {
    console.error('=== SMTP Error ===', error?.message);
    try {
      if (tlsConn) tlsConn.close();
      if (conn) conn.close();
    } catch (closeError) {
      console.error('Error closing connections:', closeError);
    }
    throw new Error(`Failed to send email via SMTP: ${error.message}`);
  }
}

// ─── Handler ──────────────────────────────────────────────────────────────────

const handler = async (req: Request): Promise<Response> => {
  return await Sentry.withScope(async () => {
    Sentry.setTag("function", "send-quick-quote-email");

    if (req.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      const {
        quickQuoteId,
        quoteData,
        recipientEmail,
        recipientName,
        isUpdate,
      }: QuickQuoteEmailRequest = await req.json();

      if (!recipientEmail) {
        throw new Error('Missing required field: recipientEmail');
      }
      if (!quickQuoteId && !quoteData) {
        throw new Error('Missing required field: quickQuoteId or quoteData');
      }

      const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2.76.1');
      const admin = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      );

      // The stored row wins over anything the client sent.
      let quote: any = quoteData ?? null;
      if (quickQuoteId) {
        const { data, error } = await admin
          .from('quick_quotes')
          .select('*')
          .eq('id', quickQuoteId)
          .maybeSingle();

        if (error) console.error('Error loading quick quote:', error.message);
        if (data) quote = data;
      }

      if (!quote) {
        throw new Error('Quick quote not found');
      }

      let companyName = 'Thunder Pro';
      let ownerEmail: string | null = null;
      let ownerProfile: Record<string, string | null> | null = null;

      if (quote.user_id) {
        const { data: profile } = await admin
          .from('profiles')
          .select('first_name, last_name, company_name, company_email, company_phone, company_address, company_apt_suite, company_city, company_state, company_zip, timezone')
          .eq('user_id', quote.user_id)
          .maybeSingle();

        if (profile) ownerProfile = profile;
        if (profile?.company_name) companyName = profile.company_name;
        if (profile?.company_email) ownerEmail = profile.company_email;
      }

      const who = recipientName || quote.recipient_name || '';
      const clientFirst = personFirstName(who);
      const ownerName = [ownerProfile?.first_name, ownerProfile?.last_name].filter(Boolean).join(' ').trim();
      const publicSupabaseUrl = resolvePublicSupabaseUrl();
      const trackingPixelUrl =
        `${publicSupabaseUrl}/functions/v1/mark-viewed?type=quick_quote&id=${quote.id}`;
      const viewUrl = resolveDocumentPdfUrl(quote.public_share_token || quote.id);
      const acceptUrl = `${publicSupabaseUrl}/functions/v1/accept-quick-quote?id=${quote.id}`;
      const dateLabel = quote.quote_date
        ? formatDateOnlyLong(quote.quote_date, ownerProfile?.timezone || undefined)
        : formatDateOnlyLong(new Date().toISOString().slice(0, 10));
      const serviceType = String(quote.service_sub_type || quote.service_type || 'Quote');
      const documentNumber = documentCode(quote.id);
      console.log("quickquote url", viewUrl);

      const clientSubject = isUpdate
        ? `You have an Updated quote - ${companyName}`
        : `Cleaning Quote - ${companyName}`;
      const ownerSubject = isUpdate
        ? `A quote was updated for ${who || recipientEmail}`
        : `A quote was sent to ${who || recipientEmail}`;

      const clientContact = {
        name: who,
        email: recipientEmail,
        phone: formatPhoneDisplay(quote.recipient_phone),
        address: '',
      };
      const ownerContact = {
        name: ownerName || companyName,
        email: ownerEmail || '',
        phone: formatPhoneDisplay(ownerProfile?.company_phone),
        address: formatStreetAddress([
          ownerProfile?.company_address,
          ownerProfile?.company_apt_suite,
          ownerProfile?.company_city,
          ownerProfile?.company_state,
          ownerProfile?.company_zip,
        ]),
      };
      const shared = {
        kind: 'quote' as const,
        companyName,
        clientFirstName: clientFirst,
        documentNumber,
        dateLabel,
        serviceType,
        pdfUrl: viewUrl,
        isUpdate,
      };
      const clientHtml = renderDocumentEmail({
        ...shared,
        audience: 'client',
        moment: 'sent',
        greetingName: clientFirst,
        contact: clientContact,
        acceptUrl,
        trackingPixelUrl,
      });
      const ownerHtml = renderDocumentEmail({
        ...shared,
        audience: 'owner',
        moment: 'sent',
        greetingName: personFirstName(ownerName),
        contact: ownerContact,
        acceptUrl: null,
      });

      console.log(`Sending quick quote ${quote.id} to ${recipientEmail}`);
      await sendEmailViaSMTP(recipientEmail, null, clientSubject, clientHtml, ownerEmail);

      // Delay mirrors send-estimate-email: avoids Gmail threading both copies.
      if (ownerEmail && ownerEmail !== recipientEmail) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        await sendEmailViaSMTP(ownerEmail, null, ownerSubject, ownerHtml, ownerEmail);
      }

      // Best-effort delivery state — never fails the request.
      const { error: updateError } = await admin
        .from('quick_quotes')
        .update({
          status: ['Draft', 'Pending', null].includes(quote.status) ? 'Sent' : quote.status,
          sent_at: new Date().toISOString(),
          last_sent_channel: 'email',
          recipient_email: recipientEmail,
          ...(recipientName ? { recipient_name: recipientName } : {}),
          is_draft: false,
        })
        .eq('id', quote.id);

      if (updateError) console.error('Could not update quick quote delivery state:', updateError.message);

      return new Response(
        JSON.stringify({
          success: true,
          message: 'Emails sent successfully',
          recipient: recipientEmail,
          ownerCopied: !!ownerEmail,
          quoteUrl: viewUrl,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
      );
    } catch (error: any) {
      Sentry.captureException(error);
      console.error('Error in send-quick-quote-email function:', error);
      return new Response(
        JSON.stringify({ success: false, error: error.message || 'Failed to send email' }),
        { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
      );
    }
  });
};

serve(handler);
