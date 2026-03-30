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

/** When SMS uses .../view-contract?token=..., derive .../download-contract-pdf?token=... for logs. */
function tryInferPdfUrlFromContractUrl(contractUrl: string): string | null {
  try {
    const u = new URL(contractUrl);
    const token = u.searchParams.get("token");
    if (!token || !u.pathname.includes("view-contract")) return null;
    const pdfPath = u.pathname.replace(/view-contract\/?$/, "download-contract-pdf");
    return `${u.origin}${pdfPath}?token=${encodeURIComponent(token)}`;
  } catch {
    return null;
  }
}

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
      console.log("[send-contract-sms] Request body:", JSON.stringify(body, null, 2));

      const { phoneNumber, clientName, contractUrl, contractTotal, isUpdate }: ContractSMSRequest = body;

      if (!phoneNumber || !clientName || !contractUrl) {
        console.error("[send-contract-sms] Validation failed: missing phoneNumber, clientName, or contractUrl");
        throw new Error("Phone number, client name, and contract URL are required");
      }

      console.log("[send-contract-sms] URL embedded in SMS (client opens this link):", contractUrl);
      const inferredPdfUrl = tryInferPdfUrlFromContractUrl(contractUrl);
      if (inferredPdfUrl) {
        console.log("[send-contract-sms] Inferred direct PDF URL (same token):", inferredPdfUrl);
      } else if (contractUrl.includes("download-contract-pdf")) {
        console.log("[send-contract-sms] contractUrl appears to be a direct PDF download link");
      } else {
        console.log("[send-contract-sms] No PDF URL inferred (expected if contractUrl is not view-contract?token=...)");
      }

      const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
      const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
      const twilioPhone = Deno.env.get("TWILIO_PHONE_NUMBER");

      if (!accountSid || !authToken || !twilioPhone) {
        console.error("[send-contract-sms] Missing Twilio env: check TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER");
        throw new Error("Missing Twilio credentials");
      }

      const normalizedPhone = normalizePhoneNumber(phoneNumber);
      console.log("[send-contract-sms] Recipient (normalized):", normalizedPhone, "| clientName:", clientName, "| isUpdate:", !!isUpdate);

      const totalText = contractTotal != null && !Number.isNaN(Number(contractTotal))
        ? ` ($${Number(contractTotal).toFixed(2)})`
        : "";
      let message = `Hi ${clientName}, your service agreement${totalText} is ready. View and download here: ${contractUrl}`;

      if (isUpdate) {
        message = `Hi ${clientName}, your service agreement${totalText} has been updated. View and download here: ${contractUrl}`;
      }

      console.log("[send-contract-sms] SMS body length:", message.length, "chars");
      console.log("[send-contract-sms] SMS body preview:", message.substring(0, 120) + (message.length > 120 ? "…" : ""));

      const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
      console.log("[send-contract-sms] Calling Twilio API…");

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
      console.log("[send-contract-sms] Twilio HTTP status:", response.status, response.statusText);
      console.log("[send-contract-sms] Twilio response JSON:", JSON.stringify(data, null, 2));

      if (!response.ok) {
        console.error("[send-contract-sms] Twilio error — SMS NOT sent");
        throw new Error(data.message || data.error_message || "Failed to send SMS");
      }

      console.log("[send-contract-sms] SUCCESS — SMS sent | messageSid:", data.sid, "| status:", data.status ?? "n/a");

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
      console.error("[send-contract-sms] FAILURE —", msg);
      console.error("[send-contract-sms] Error detail:", error);
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
