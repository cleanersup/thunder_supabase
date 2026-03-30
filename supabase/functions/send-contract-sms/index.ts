import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import * as Sentry from "npm:@sentry/deno";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Sentry.init({
  dsn: "https://ce035a76b6157a602d88c53eab6570e4@o4509804047958016.ingest.us.sentry.io/4510552540971008",
  environment: Deno.env.get("SUPABASE_URL")?.includes("staging") ? "staging" : "production",
  tracesSampleRate: 0.1,
});

/** Same shape as send-invoice-sms / send-estimate-sms: client supplies the public contract URL. */
interface ContractSMSRequest {
  phoneNumber: string;
  clientName: string;
  contractUrl: string;
  contractTotal?: number;
  isUpdate?: boolean;
}

const normalizePhoneNumber = (phone: string): string => {
  const cleaned = phone.replace(/[^\d+]/g, "");
  if (cleaned.startsWith("+1")) {
    return cleaned;
  }
  const digits = cleaned.startsWith("+") ? cleaned.slice(1) : cleaned;
  return `+1${digits}`;
};

serve(async (req) => {
  return await Sentry.withScope(async () => {
    Sentry.setTag("function", "send-contract-sms");

    if (req.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    console.log("=== send-contract-sms FUNCTION TRIGGERED ===");
    console.log("Timestamp:", new Date().toISOString());

    try {
      const body = await req.json();
      const { phoneNumber, clientName, contractUrl, contractTotal, isUpdate }: ContractSMSRequest = body;

      if (!phoneNumber || !clientName || !contractUrl) {
        throw new Error("Phone number, client name, and contract URL are required");
      }

      const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
      const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
      const twilioPhone = Deno.env.get("TWILIO_PHONE_NUMBER");

      if (!accountSid || !authToken || !twilioPhone) {
        throw new Error("Missing Twilio credentials");
      }

      const normalizedPhone = normalizePhoneNumber(phoneNumber);

      const totalText = contractTotal != null && !Number.isNaN(Number(contractTotal))
        ? ` ($${Number(contractTotal).toFixed(2)})`
        : "";
      let message = `Hi ${clientName}, your service agreement${totalText} is ready. View and download here: ${contractUrl}`;

      if (isUpdate) {
        message = `Hi ${clientName}, your service agreement${totalText} has been updated. View and download here: ${contractUrl}`;
      }

      const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;

      const response = await fetch(twilioUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Authorization": "Basic " + btoa(`${accountSid}:${authToken}`),
        },
        body: new URLSearchParams({
          To: normalizedPhone,
          From: twilioPhone,
          Body: message,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || data.error_message || "Failed to send SMS");
      }

      return new Response(
        JSON.stringify({ success: true, messageSid: data.sid }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        },
      );
    } catch (error: unknown) {
      Sentry.captureException(error);
      const msg = error instanceof Error ? error.message : "Internal server error";
      console.error("Error in send-contract-sms:", error);
      return new Response(
        JSON.stringify({ error: msg }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        },
      );
    }
  });
});
