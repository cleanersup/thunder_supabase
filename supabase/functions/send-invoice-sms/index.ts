import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
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

interface InvoiceSMSRequest {
  phoneNumber: string;
  clientName: string;
  invoiceUrl: string;
  invoiceTotal?: number;
  isUpdate?: boolean;
}

// Normalize phone number: add +1 prefix if not present
const normalizePhoneNumber = (phone: string): string => {
  // Remove all non-digit characters except leading +
  const cleaned = phone.replace(/[^\d+]/g, '');

  // If already starts with +1, return as is
  if (cleaned.startsWith('+1')) {
    return cleaned;
  }

  // Remove leading + if present but not +1
  const digits = cleaned.startsWith('+') ? cleaned.slice(1) : cleaned;

  // Add +1 prefix
  return `+1${digits}`;
};

serve(async (req) => {
  return await Sentry.withScope(async (scope) => {
    Sentry.setTag("function", "send-invoice-sms");

    if (req.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    console.log("=== send-invoice-sms FUNCTION TRIGGERED ===");
    console.log("Timestamp:", new Date().toISOString());

    try {
      const body = await req.json();
      const { phoneNumber, clientName, invoiceUrl, invoiceTotal, isUpdate }: InvoiceSMSRequest = body;

      if (!phoneNumber || !clientName || !invoiceUrl) {
        throw new Error('Phone number, client name, and invoice URL are required');
      }

      console.log("=== INVOICE SMS REQUEST ===");
      console.log("Is Update:", isUpdate);

      const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID');
      const authToken = Deno.env.get('TWILIO_AUTH_TOKEN');
      const twilioPhone = Deno.env.get('TWILIO_PHONE_NUMBER');

      if (!accountSid || !authToken || !twilioPhone) {
        throw new Error('Missing Twilio credentials');
      }

      // Normalize phone number
      const normalizedPhone = normalizePhoneNumber(phoneNumber);
      console.log("Phone number normalized:", phoneNumber, "->", normalizedPhone);

      const totalText = invoiceTotal ? ` for $${invoiceTotal.toFixed(2)}` : '';
      let message = `Hi ${clientName}, your invoice${totalText} is ready. View and pay here: ${invoiceUrl}`;

      // Add extra text when invoice is updated
      if (isUpdate) {
        message = `Hi ${clientName}, your invoice${totalText} has updates and is ready. View and pay here: ${invoiceUrl}.`;
      }

      console.log("=== PREPARING SMS MESSAGE ===");
      console.log("Is Update:", isUpdate);
      console.log("Message text that will be sent:", message);
      console.log("Message length:", message.length, "characters");

      const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;

      console.log("=== SENDING SMS VIA TWILIO ===");
      console.log("Final SMS message text:", message);
      console.log("Recipient phone:", normalizedPhone);
      console.log("From phone:", twilioPhone);

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
        throw new Error(data.message || data.error_message || 'Failed to send SMS');
      }

      return new Response(
        JSON.stringify({ success: true, messageSid: data.sid }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        }
      );
    } catch (error: any) {
      Sentry.captureException(error);
      console.error("Error in send-invoice-sms:", error);
      return new Response(
        JSON.stringify({ error: error?.message || 'Internal server error' }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 500,
        }
      );
    }
  });
});

