// send-quick-quote-sms
//
// Texts a quick quote to a number typed by the owner (a quick quote has no client
// record). Same Twilio transport and message wording as send-estimate-sms; the
// greeting falls back to "Hi there" when no recipient name was typed.
//
// Body: { phoneNumber, quickQuoteId?, recipientName?, quoteUrl?, quoteTotal?, isUpdate? }

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import * as Sentry from "npm:@sentry/deno";
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

interface QuickQuoteSMSRequest {
  phoneNumber: string;
  quickQuoteId?: string;
  recipientName?: string;
  /** Overrides the default public quote link. */
  quoteUrl?: string;
  quoteTotal?: number;
  isUpdate?: boolean;
}

/** Normalize phone number: add +1 prefix if not present. */
const normalizePhoneNumber = (phone: string): string => {
  const cleaned = phone.replace(/[^\d+]/g, '');
  if (cleaned.startsWith('+1')) return cleaned;
  const digits = cleaned.startsWith('+') ? cleaned.slice(1) : cleaned;
  return `+1${digits}`;
};

function isPercentageDiscount(type: string | null | undefined): boolean {
  return type === 'percentage' || type === 'percent';
}

function resolveQuoteDisplayTotal(quote: any): number {
  const subtotal = Number(quote?.subtotal) || 0;
  const storedTotal = Number(quote?.total) || 0;
  const discountValue = Number(quote?.discount_value) || 0;

  if (discountValue <= 0) return storedTotal || subtotal;

  const discountAmount = isPercentageDiscount(quote?.discount_type)
    ? subtotal * discountValue / 100
    : discountValue;
  const computedTotal = Math.max(0, subtotal - discountAmount);

  if (Math.abs(storedTotal - subtotal) < 0.01 && computedTotal < subtotal) {
    return computedTotal;
  }

  return storedTotal || computedTotal;
}

serve(async (req) => {
  return await Sentry.withScope(async () => {
    Sentry.setTag("function", "send-quick-quote-sms");

    if (req.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      const {
        phoneNumber,
        quickQuoteId,
        recipientName,
        quoteUrl,
        quoteTotal,
        isUpdate,
      }: QuickQuoteSMSRequest = await req.json();

      if (!phoneNumber) throw new Error('Phone number is required');
      if (!quickQuoteId && !quoteUrl) {
        throw new Error('Either quickQuoteId or quoteUrl is required');
      }

      const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2.76.1');
      const admin = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      );

      let quote: any = null;
      if (quickQuoteId) {
        const { data, error } = await admin
          .from('quick_quotes')
          .select('*')
          .eq('id', quickQuoteId)
          .maybeSingle();

        if (error) console.error('Error loading quick quote:', error.message);
        quote = data ?? null;
      }

      const resolvedUrl = quoteUrl
        ?? (quote?.public_share_token
          ? `${resolvePublicAppUrl()}/public/quick-quote/${quote.public_share_token}`
          : null);

      if (!resolvedUrl) {
        throw new Error('Quote URL is required (quote has no public share token)');
      }

      const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID');
      const authToken = Deno.env.get('TWILIO_AUTH_TOKEN');
      const twilioPhone = Deno.env.get('TWILIO_PHONE_NUMBER');

      if (!accountSid || !authToken || !twilioPhone) {
        throw new Error('Missing Twilio credentials');
      }

      const normalizedPhone = normalizePhoneNumber(phoneNumber);

      const resolvedTotal = typeof quoteTotal === 'number'
        ? quoteTotal
        : (quote ? resolveQuoteDisplayTotal(quote) : 0);
      const totalText = resolvedTotal > 0 ? ` for $${resolvedTotal.toFixed(2)}` : '';
      const greetingName = recipientName || quote?.recipient_name || 'there';

      const message = isUpdate
        ? `Hi ${greetingName}, your cleaning estimate${totalText} has been updated. View it here: ${resolvedUrl}`
        : `Hi ${greetingName}, your cleaning estimate${totalText} is ready. View it here: ${resolvedUrl}`;

      console.log('Sending quick quote SMS to', normalizedPhone, '| length:', message.length);

      const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
      const response = await fetch(twilioUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': 'Basic ' + btoa(`${accountSid}:${authToken}`),
        },
        body: new URLSearchParams({
          To: normalizedPhone,
          From: twilioPhone,
          Body: message,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        console.error('Twilio API error:', JSON.stringify(data));
        throw new Error(data.message || data.error_message || 'Failed to send SMS');
      }

      // Best-effort delivery state — never fails the request.
      if (quote?.id) {
        const { error: updateError } = await admin
          .from('quick_quotes')
          .update({
            status: ['Draft', 'Pending', null].includes(quote.status) ? 'Sent' : quote.status,
            sent_at: new Date().toISOString(),
            last_sent_channel: 'sms',
            recipient_phone: phoneNumber,
            ...(recipientName ? { recipient_name: recipientName } : {}),
            is_draft: false,
          })
          .eq('id', quote.id);

        if (updateError) {
          console.error('Could not update quick quote delivery state:', updateError.message);
        }
      }

      return new Response(
        JSON.stringify({ success: true, messageSid: data.sid, quoteUrl: resolvedUrl }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 },
      );
    } catch (error: any) {
      Sentry.captureException(error);
      console.error('Error in send-quick-quote-sms function:', error?.message || String(error));
      return new Response(
        JSON.stringify({ success: false, error: error?.message || 'Internal server error' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 },
      );
    }
  });
});
