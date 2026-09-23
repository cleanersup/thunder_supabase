// send-quick-quote-email
//
// Emails a quick quote to an address typed by the owner (a quick quote has no
// client record). Same template as the residential estimate email: the "Client
// Information" block is replaced by "Prepared For" with whatever contact the
// owner typed, and there is no address line.
//
// Body: { quickQuoteId, recipientEmail, recipientName?, publicUrl?, isUpdate?, quoteData? }

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import * as Sentry from "npm:@sentry/deno";
import { resolvePublicSupabaseUrl } from "../_shared/resolvePublicSupabaseUrl.ts";
import { resolvePublicAppUrl } from "../_shared/resolvePublicAppUrl.ts";

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
  /** Overrides the default public quote link used by the "View Quote" button. */
  publicUrl?: string;
  isUpdate?: boolean;
}

// ─── Pricing helpers (same rules as send-estimate-email) ─────────────────────

function isPercentageDiscount(type: string | null | undefined): boolean {
  return type === 'percentage' || type === 'percent';
}

function computeDiscountAmount(
  subtotal: number,
  discountType: string | null | undefined,
  discountValue: number | string | null | undefined,
): number {
  const val = Number(discountValue);
  if (!Number.isFinite(val) || val <= 0) return 0;
  if (isPercentageDiscount(discountType)) {
    return subtotal * val / 100;
  }
  return val;
}

function resolveQuoteDisplayTotal(quote: {
  subtotal?: number | null;
  total?: number | null;
  discount_type?: string | null;
  discount_value?: number | null;
}): number {
  const subtotal = Number(quote.subtotal) || 0;
  const storedTotal = Number(quote.total) || 0;

  if (!quote.discount_value || Number(quote.discount_value) <= 0) {
    return storedTotal || subtotal;
  }

  const discountAmount = computeDiscountAmount(subtotal, quote.discount_type, quote.discount_value);
  const computedTotal = Math.max(0, subtotal - discountAmount);

  if (Math.abs(storedTotal - subtotal) < 0.01 && computedTotal < subtotal) {
    return computedTotal;
  }

  return storedTotal || computedTotal;
}

// ─── Shared template pieces ───────────────────────────────────────────────────

function getTodayDate(): string {
  const now = new Date();
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  return `${months[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()}`;
}

/** Same three-column Main / Additional / Extra table used by residential estimates. */
function formatServiceBreakdown(quote: any): string {
  const mainData = quote.main_data || {};
  const additionalData = quote.additional_data || {};
  const extraServices = quote.extra_services || {};

  const getNumericValue = (data: any, camelKey: string, snakeKey?: string) => {
    const value = data[camelKey] ?? data[snakeKey || camelKey.toLowerCase()];
    if (value === null || value === undefined || value === '') return 0;
    const numValue = Number(value);
    return isNaN(numValue) ? 0 : numValue;
  };

  const mainServices: string[] = [];
  const bedrooms = getNumericValue(mainData, 'bedrooms');
  const kitchens = getNumericValue(mainData, 'kitchens');
  const livingRooms = getNumericValue(mainData, 'livingRooms', 'living_rooms');
  const diningRooms = getNumericValue(mainData, 'diningRooms', 'dining_rooms');
  const offices = getNumericValue(mainData, 'offices');
  const fullBaths = getNumericValue(mainData, 'fullBaths', 'full_baths');
  const halfBaths = getNumericValue(mainData, 'halfBaths', 'half_baths');

  if (bedrooms > 0) mainServices.push(`${bedrooms}x Bedrooms`);
  if (kitchens > 0) mainServices.push(`${kitchens}x Kitchens`);
  if (livingRooms > 0) mainServices.push(`${livingRooms}x Living Rooms`);
  if (diningRooms > 0) mainServices.push(`${diningRooms}x Dining Rooms`);
  if (offices > 0) mainServices.push(`${offices}x Offices`);
  if (fullBaths > 0) mainServices.push(`${fullBaths}x Full Baths`);
  if (halfBaths > 0) mainServices.push(`${halfBaths}x Half Baths`);
  if (mainData.squareFootage || mainData.square_footage) mainServices.push(`1x Square Footage`);

  const additionalServices: string[] = [];
  const fans = getNumericValue(additionalData, 'fans');
  const oven = getNumericValue(additionalData, 'oven');
  const refrigerator = getNumericValue(additionalData, 'refrigerator');
  const blinds = getNumericValue(additionalData, 'blinds');
  const windowsInside = getNumericValue(additionalData, 'windowsInside', 'windows_inside');
  const windowsOutside = getNumericValue(additionalData, 'windowsOutside', 'windows_outside');

  if (fans > 0) additionalServices.push(`${fans}x Fans`);
  if (oven > 0) additionalServices.push(`${oven}x Oven`);
  if (refrigerator > 0) additionalServices.push(`${refrigerator}x Refrigerator`);
  if (blinds > 0) additionalServices.push(`${blinds}x Blinds`);
  if (windowsInside > 0) additionalServices.push(`${windowsInside}x Windows Inside`);
  if (windowsOutside > 0) additionalServices.push(`${windowsOutside}x Windows Outside`);

  const extraServicesList: string[] = [];
  if (extraServices.baseboard) extraServicesList.push('1x Baseboards');
  if (extraServices.patio) extraServicesList.push('1x Patio');
  if (extraServices.walls) extraServicesList.push('1x Walls');
  if (extraServices.stairs) extraServicesList.push('1x Stairs');
  if (extraServices.cabinetInside || extraServices.cabinet_inside) extraServicesList.push('1x Cabinet Inside');
  if (extraServices.cabinetOutside || extraServices.cabinet_outside) extraServicesList.push('1x Cabinet Outside');
  if (extraServices.washDishes || extraServices.wash_dishes) extraServicesList.push('1x Wash Dishes');
  if (extraServices.hallways) extraServicesList.push('1x Hallways');
  if (extraServices.basement) extraServicesList.push('1x Basement');

  if (mainServices.length === 0 && additionalServices.length === 0 && extraServicesList.length === 0) {
    return '';
  }

  const maxRows = Math.max(mainServices.length, additionalServices.length, extraServicesList.length);

  let tableRows = '';
  for (let i = 0; i < maxRows; i++) {
    tableRows += `
        <tr>
          <td style="padding:6px 8px;text-align:left;border-bottom:1px solid #e5e7eb">${mainServices[i] || ''}</td>
          <td style="padding:6px 8px;text-align:left;border-bottom:1px solid #e5e7eb">${additionalServices[i] || ''}</td>
          <td style="padding:6px 8px;text-align:left;border-bottom:1px solid #e5e7eb">${extraServicesList[i] || ''}</td>
        </tr>`;
  }

  return `
<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Service Breakdown</h3>
<div style="border-top:1px solid #1e3a8a;margin-bottom:12px"></div>
<table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin-bottom:20px">
  <thead>
    <tr style="background-color:#1e3a8a;color:white">
      <th style="padding:10px 8px;text-align:left;font-weight:bold">Main Services</th>
      <th style="padding:10px 8px;text-align:left;font-weight:bold">Additional Services</th>
      <th style="padding:10px 8px;text-align:left;font-weight:bold">Extra Services</th>
    </tr>
  </thead>
  <tbody>
    ${tableRows}
  </tbody>
</table>`;
}

function formatPricingSection(quote: any): string {
  const f = (n: number) => `$${Number(n).toFixed(2)}`;
  const subtotal = Number(quote.subtotal) || 0;
  const discountValue = Number(quote.discount_value) || 0;
  const hasDiscount = discountValue > 0 && !!quote.discount_type;
  const discountAmount = hasDiscount
    ? computeDiscountAmount(subtotal, quote.discount_type, discountValue)
    : 0;
  const discountLabel = hasDiscount && isPercentageDiscount(quote.discount_type)
    ? `Discount (${discountValue}%):`
    : 'Discount:';

  return `<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Pricing</h3>
<table cellpadding="0" cellspacing="0" style="width:100%;background-color:#f0fdf4">
  <tr>
    <td style="padding:16px">
      <table cellpadding="0" cellspacing="0" style="width:100%">
        <tr>
          <td style="padding:8px 0;text-align:left">Subtotal:</td>
          <td style="padding:8px 0;text-align:right">${f(subtotal)}</td>
        </tr>
        ${hasDiscount ? `
        <tr>
          <td style="padding:8px 0;text-align:left">${discountLabel}</td>
          <td style="padding:8px 0;text-align:right">-${f(discountAmount)}</td>
        </tr>` : ''}
        <tr>
          <td style="padding:12px 0 0 0;text-align:left;font-weight:bold;font-size:20px;color:#1e3a8a;border-top:1px solid #d1d5db">Total:</td>
          <td style="padding:12px 0 0 0;text-align:right;font-weight:bold;font-size:20px;color:#1e3a8a;border-top:1px solid #d1d5db">${f(resolveQuoteDisplayTotal(quote))}</td>
        </tr>
      </table>
    </td>
  </tr>
</table>`;
}

/** "Prepared For" replaces the estimate's "Client Information" block. Omitted when empty. */
function formatRecipientSection(quote: any, recipientEmail: string, recipientName?: string): string {
  const name = recipientName || quote.recipient_name || '';
  const phone = quote.recipient_phone || '';

  const lines = [
    name ? `<strong>Name:</strong> ${name}` : '',
    `<strong>Email:</strong> ${recipientEmail}`,
    phone ? `<strong>Phone:</strong> ${phone}` : '',
  ].filter(Boolean).join('<br>');

  return `<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Prepared For</h3>
<div style="border-top:1px solid #1e3a8a;margin-bottom:12px"></div>
<p>${lines}</p>`;
}

function formatServiceDetailsSection(quote: any): string {
  const serviceType = quote.service_type || 'Residential';
  const subType = quote.service_sub_type ? ` - ${quote.service_sub_type}` : '';

  return `<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Service Details</h3>
<div style="border-top:1px solid #1e3a8a;margin-bottom:12px"></div>
<p><strong>Date:</strong> ${getTodayDate()}<br>
<strong>Service Type:</strong> ${serviceType}${subType}</p>

${quote.service_scope ? `<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Scope of Work</h3><div style="border-top:1px solid #1e3a8a;margin-bottom:12px"></div><p>${quote.service_scope}</p>` : ''}`;
}

const EMAIL_HEAD = `<head>
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
</head>`;

const EMAIL_FOOTER = `<div style="text-align:center;padding:15px;background:#1e3a8a;color:white">
<p style="margin:0 0 5px 0;font-size:12px">Service provided by</p>
<p style="margin:0">© 2024 Thunder Pro Inc. | <a href="https://www.thunderpro.co" style="color:white">www.thunderpro.co</a></p>
</div>`;

// ─── Templates ────────────────────────────────────────────────────────────────

function formatClientActionButtons(acceptUrl: string, quoteUrl: string | null): string {
  return `<div style="text-align:center;margin:30px 0">
<a href="${acceptUrl}" style="display:inline-block;background:#10b981;color:white;padding:15px 40px;text-decoration:none;border-radius:5px;font-weight:bold;margin:10px">Accept Estimate</a>
${quoteUrl ? `<a href="${quoteUrl}" style="display:inline-block;background:#1e3a8a;color:white;padding:15px 40px;text-decoration:none;border-radius:5px;font-weight:bold;margin:10px">View Quote</a>` : ''}
</div>`;
}

function generateQuickQuoteClientEmailTemplate(
  quote: any,
  companyName: string,
  recipientEmail: string,
  recipientName: string | undefined,
  quoteUrl: string | null,
  acceptUrl: string,
  trackingPixelUrl: string,
): string {
  return `<!DOCTYPE html>
<html>
${EMAIL_HEAD}
<body style="margin:0;padding:20px;font-family:Arial,sans-serif">
<div class="email-container" style="max-width:600px;margin:0 auto">

<div class="email-body" style="text-align:center;padding:15px;background:#1e3a8a;color:white">
<h1 style="margin:0;font-size:22px">${companyName}</h1>
<p style="margin:5px 0">Professional Cleaning Estimate</p>
</div>

<div class="email-content" style="padding:15px">

${formatRecipientSection(quote, recipientEmail, recipientName)}

${formatServiceDetailsSection(quote)}

${formatServiceBreakdown(quote)}

${formatPricingSection(quote)}

${formatClientActionButtons(acceptUrl, quoteUrl)}

</div>

${EMAIL_FOOTER}

<!-- Tracking pixel to mark email as viewed -->
<img src="${trackingPixelUrl}" width="1" height="1" style="display:none;" alt="" />

</div>
</body>
</html>`;
}

function generateQuickQuoteOwnerEmailTemplate(
  quote: any,
  companyName: string,
  recipientEmail: string,
  recipientName: string | undefined,
  quoteUrl: string | null,
): string {
  const total = resolveQuoteDisplayTotal(quote);
  const operationCost = Number(quote.total_operation_cost) || 0;
  const profit = total - operationCost;
  const margin = (profit / (total || 1)) * 100;

  return `<!DOCTYPE html>
<html>
${EMAIL_HEAD}
<body style="margin:0;padding:20px;font-family:Arial,sans-serif">
<div class="email-container" style="max-width:600px;margin:0 auto">

<div class="email-body" style="text-align:center;padding:15px;background:#1e3a8a;color:white">
<p style="margin:0;font-size:14px;font-weight:bold;background:#1e40af;padding:8px;border-radius:4px">OWNER COPY - INTERNAL USE ONLY</p>
<h1 style="margin:10px 0 0 0;font-size:22px">${companyName}</h1>
<p style="margin:5px 0">Professional Cleaning Estimate</p>
</div>

<div class="email-content" style="padding:15px">

<div style="background:#f0fdf4;padding:12px;border-left:4px solid #10b981;margin-bottom:15px">
<p style="margin:0;font-weight:bold;color:#059669">Internal Cost Breakdown</p>
<p style="margin:5px 0 0 0;font-size:13px">
<strong>Labor Cost:</strong> $${(Number(quote.labor_cost) || 0).toFixed(2)} |
<strong>Supplies:</strong> $${(Number(quote.supplies_cost) || 0).toFixed(2)} |
<strong>Overhead:</strong> $${(Number(quote.overhead_cost) || 0).toFixed(2)}<br>
<strong>Total Costs:</strong> $${operationCost.toFixed(2)} |
<strong>Profit:</strong> $${profit.toFixed(2)} (${margin.toFixed(1)}%)
</p>
</div>

${formatRecipientSection(quote, recipientEmail, recipientName)}

${formatServiceDetailsSection(quote)}

${formatServiceBreakdown(quote)}

${formatPricingSection(quote)}

${quoteUrl ? `<div style="text-align:center;margin:30px 0">
<a href="${quoteUrl}" style="display:inline-block;background:#1e3a8a;color:white;padding:15px 40px;text-decoration:none;border-radius:5px;font-weight:bold;margin:10px">View Quote</a>
</div>` : ''}

</div>

${EMAIL_FOOTER}

</div>
</body>
</html>`;
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
        publicUrl,
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

      // Company branding + owner copy address.
      let companyName = 'Thunder Pro';
      let ownerEmail: string | null = null;

      if (quote.user_id) {
        const { data: profile } = await admin
          .from('profiles')
          .select('company_name, company_email')
          .eq('user_id', quote.user_id)
          .maybeSingle();

        if (profile?.company_name) companyName = profile.company_name;
        if (profile?.company_email) ownerEmail = profile.company_email;
      }

      const publicSupabaseUrl = resolvePublicSupabaseUrl();
      const trackingPixelUrl =
        `${publicSupabaseUrl}/functions/v1/mark-viewed?type=quick_quote&id=${quote.id}`;

      const quoteUrl = publicUrl
        ?? (quote.public_share_token
          ? `${resolvePublicAppUrl()}/public/quick-quote/${quote.public_share_token}`
          : null);
      const acceptUrl = `${publicSupabaseUrl}/functions/v1/accept-quick-quote?id=${quote.id}`;

      const clientSubject = isUpdate
        ? `You have an Updated quote - ${companyName}`
        : `Cleaning Quote - ${companyName}`;
      const ownerSubject = isUpdate
        ? `A quote was updated for ${recipientName || recipientEmail}`
        : `A quote was sent to ${recipientName || recipientEmail}`;

      const clientHtml = generateQuickQuoteClientEmailTemplate(
        quote, companyName, recipientEmail, recipientName, quoteUrl, acceptUrl, trackingPixelUrl,
      );
      const ownerHtml = generateQuickQuoteOwnerEmailTemplate(
        quote, companyName, recipientEmail, recipientName, quoteUrl,
      );

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
          quoteUrl,
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
