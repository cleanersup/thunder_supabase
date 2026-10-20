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
  todayLongDate,
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

interface EstimateEmailRequest {
  estimateData: any;
  recipientEmail: string;
  estimateType: 'residential' | 'commercial';
  isUpdate?: boolean;
}

function estimateServiceLabel(estimateType: string): string {
  return estimateType === "commercial" ? "Commercial" : "Residential";
}

// Function to convert file to base64 (for embedding badges in email)
async function getImageAsBase64(imagePath: string): Promise<string> {
  try {
    const response = await fetch(imagePath);
    const blob = await response.blob();
    const buffer = await blob.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
    return `data:${blob.type};base64,${base64}`;
  } catch (error) {
    console.error('Error loading image:', error);
    return '';
  }
}

// Optimized SMTP implementation for large HTML emails
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

    // Build email in chunks to avoid memory issues
    console.log('[9/10] Sending email headers...');

    // Generate unique identifiers to prevent Gmail threading/grouping
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
      `X-Mailer: ThunderPro-Estimates`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=UTF-8',
      '',
    ].join('\r\n');

    await tlsConn.write(encoder.encode(headers + '\r\n'));

    // Send HTML content in smaller chunks (4KB at a time)
    console.log('[9/10] Sending email body in chunks...');
    const chunkSize = 4096;
    const contentBytes = encoder.encode(htmlContent);

    for (let i = 0; i < contentBytes.length; i += chunkSize) {
      const chunk = contentBytes.slice(i, Math.min(i + chunkSize, contentBytes.length));
      await tlsConn.write(chunk);
    }

    // Send end marker
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

const handler = async (req: Request): Promise<Response> => {
  return await Sentry.withScope(async (scope) => {
    Sentry.setTag("function", "send-estimate-email");

    if (req.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      const { estimateData, recipientEmail, estimateType, isUpdate }: EstimateEmailRequest = await req.json();

      // Debug: Log current date/time when function is called
      const functionCallTime = new Date();
      console.log('=== send-estimate-email Function Called ===');
      console.log('Function call timestamp:', functionCallTime.toISOString());
      console.log('Function call local time:', functionCallTime.toString());
      console.log('Function call UTC date:', functionCallTime.getUTCFullYear() + '-' + (functionCallTime.getUTCMonth() + 1) + '-' + functionCallTime.getUTCDate());
      console.log('Function call local date:', functionCallTime.getFullYear() + '-' + (functionCallTime.getMonth() + 1) + '-' + functionCallTime.getDate());
      console.log('Estimate date from DB:', estimateData?.estimate_date);
      console.log('==========================================');

      console.log('Processing estimate email request:', {
        estimateType,
        recipientEmail,
        estimateId: estimateData?.id
      });

      if (!estimateData || !recipientEmail || !estimateType) {
        throw new Error('Missing required fields: estimateData, recipientEmail, or estimateType');
      }

      // Get the company email and timezone from profiles table
      const authHeader = req.headers.get('Authorization');
      console.log('Auth header present:', !!authHeader);

      let ownerEmail: string | null = null;
      let userTimezone: string = 'UTC';
      let ownerProfile: Record<string, string | null> | null = null;

      if (authHeader) {
        try {
          const token = authHeader.replace('Bearer ', '');
          const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2.76.1');
          const supabaseClient = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_ANON_KEY') ?? '',
            { global: { headers: { Authorization: authHeader } } }
          );

          // First get the authenticated user ID
          const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token);
          console.log('User auth check:', { userId: user?.id, error: authError?.message });

          if (user?.id) {
            // Now get the company_email and timezone from profiles table
            const { data: profile, error: profileError } = await supabaseClient
              .from('profiles')
              .select('first_name, last_name, company_name, company_email, company_phone, company_address, company_apt_suite, company_city, company_state, company_zip, timezone')
              .eq('user_id', user.id)
              .single();

            console.log('Profile query:', {
              userId: user.id,
              companyEmail: profile?.company_email,
              timezone: profile?.timezone,
              error: profileError?.message
            });

            if (profile) ownerProfile = profile;
            if (profile?.company_email) {
              ownerEmail = profile.company_email;
              console.log('✓ Owner email obtained from company profile:', ownerEmail);
            } else {
              console.log('⚠️ Profile found but no company_email available');
            }

            if (profile?.timezone) {
              userTimezone = profile.timezone;
              console.log('✓ User timezone:', userTimezone);
            } else {
              console.log('⚠️ No timezone found, using UTC');
            }
          } else {
            console.log('⚠️ User not authenticated');
          }
        } catch (error: any) {
          console.error('Error getting company email:', error.message);
        }
      } else {
        console.log('⚠️ No Authorization header found - company email will not be copied');
      }

      console.log('Final company email for BCC:', ownerEmail);

      const publicSupabaseUrl = resolvePublicSupabaseUrl();
      const pdfUrl = resolveDocumentPdfUrl(estimateData.public_share_token || estimateData.id);
      console.log('Public Supabase URL for estimate email links:', publicSupabaseUrl);
      console.log('estimate url', pdfUrl);

      const trackingPixelUrl = `${publicSupabaseUrl}/functions/v1/mark-viewed?type=estimate&id=${estimateData.id}`;
      const acceptUrl = `${publicSupabaseUrl}/functions/v1/accept-estimate?id=${estimateData.id}`;
      const companyName = ownerProfile?.company_name || estimateData.company_name || 'Company Name';
      const clientFirst = personFirstName(estimateData.client_name);
      const ownerName = [ownerProfile?.first_name, ownerProfile?.last_name].filter(Boolean).join(' ').trim();
      const dateLabel = estimateData.estimate_date
        ? formatDateOnlyLong(estimateData.estimate_date, userTimezone)
        : todayLongDate();
      const serviceType = estimateServiceLabel(estimateType);
      const documentNumber = documentCode(estimateData.id);
      const clientContact = {
        name: String(estimateData.client_name || ''),
        email: String(recipientEmail || estimateData.email || ''),
        phone: formatPhoneDisplay(estimateData.phone),
        address: formatStreetAddress([
          estimateData.address,
          estimateData.apt,
          estimateData.city,
          estimateData.state,
          estimateData.zip,
        ]),
      };
      const ownerContact = {
        name: ownerName || companyName,
        email: String(ownerEmail || ownerProfile?.company_email || ''),
        phone: formatPhoneDisplay(ownerProfile?.company_phone),
        address: formatStreetAddress([
          ownerProfile?.company_address,
          ownerProfile?.company_apt_suite,
          ownerProfile?.company_city,
          ownerProfile?.company_state,
          ownerProfile?.company_zip,
        ]),
      };

      const clientSubject = isUpdate
        ? `You have an Updated estimate - ${companyName}`
        : `${serviceType} Cleaning Estimate - ${companyName}`;
      const ownerSubject = isUpdate
        ? `An estimate was updated for ${estimateData.client_name}`
        : `An estimate was sent to ${estimateData.client_name}`;

      const clientHtmlContent = renderDocumentEmail({
        kind: 'estimate',
        audience: 'client',
        moment: 'sent',
        companyName,
        greetingName: clientFirst,
        clientFirstName: clientFirst,
        documentNumber,
        dateLabel,
        serviceType,
        contact: clientContact,
        pdfUrl,
        acceptUrl,
        trackingPixelUrl,
        isUpdate,
      });
      const ownerHtmlContent = renderDocumentEmail({
        kind: 'estimate',
        audience: 'owner',
        moment: 'sent',
        companyName,
        greetingName: personFirstName(ownerName),
        clientFirstName: clientFirst,
        documentNumber,
        dateLabel,
        serviceType,
        contact: ownerContact,
        pdfUrl,
        acceptUrl: null,
        isUpdate,
      });

      // Send email to client
      console.log(`Sending email to client: ${recipientEmail}`);
      await sendEmailViaSMTP(recipientEmail, null, clientSubject, clientHtmlContent, ownerEmail);
      console.log('✓ Client email sent successfully');

      // Wait 3 seconds before sending owner email to prevent Gmail threading
      if (ownerEmail && ownerEmail !== recipientEmail) {
        console.log('Waiting 3 seconds before sending owner email...');
        await new Promise(resolve => setTimeout(resolve, 3000));

        console.log(`Sending copy to owner: ${ownerEmail}`);
        await sendEmailViaSMTP(ownerEmail, null, ownerSubject, ownerHtmlContent, ownerEmail);
        console.log('✓ Owner email sent successfully');
      }

      return new Response(
        JSON.stringify({
          success: true,
          message: 'Emails sent successfully',
          recipient: recipientEmail,
          ownerCopied: !!ownerEmail
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        }
      );

    } catch (error: any) {
      Sentry.captureException(error);
      console.error('Error in send-estimate-email function:', error);
      return new Response(
        JSON.stringify({
          success: false,
          error: error.message || 'Failed to send email'
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        }
      );
    }
  });
};

serve(handler);
