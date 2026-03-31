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

/**
 * Twilio send with step logs matching send-contract-email’s `SMTP:` lines (visible in `supabase functions serve`).
 */
async function sendContractSmsViaTwilio(params: {
  accountSid: string;
  authToken: string;
  twilioPhone: string;
  to: string;
  body: string;
}): Promise<{ sid: string; status?: string }> {
  const { accountSid, authToken, twilioPhone, to, body } = params;
  const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;

  console.log("SMS: POST /2010-04-01/Accounts/{AccountSid}/Messages.json");
  console.log("SMS: To:<" + to + ">");
  console.log("SMS: From:<" + twilioPhone + ">");
  console.log("SMS: Body length " + body.length + " chars");
  console.log("SMS: Authorization Basic <redacted>");

  const response = await fetch(twilioUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": "Basic " + btoa(`${accountSid}:${authToken}`),
    },
    body: new URLSearchParams({
      To: to,
      From: twilioPhone,
      Body: body,
    }),
  });

  const data = (await response.json()) as Record<string, unknown>;
  console.log("SMS: HTTP " + response.status + " " + response.statusText);

  if (!response.ok) {
    console.log("SMS: ERROR " + JSON.stringify(data));
    throw new Error(String(data.message || data.error_message || "Failed to send SMS"));
  }

  const sid = String(data.sid ?? "");
  const st = data.status != null ? String(data.status) : "n/a";
  console.log("SMS: MessageSid " + sid);
  console.log("SMS: Status " + st);
  console.log("SMS: done");
  return { sid, status: st };
}

serve(async (req) => {
  return await Sentry.withScope(async () => {
    Sentry.setTag("function", "send-contract-sms");

    if (req.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    console.log("=== Starting Contract SMS (Twilio) ===");
    console.log("Current time:", new Date().toISOString());

    try {
      const body = await req.json();
      console.log("SMS: Parse JSON body OK");

      const { phoneNumber, clientName, contractUrl, contractTotal, isUpdate }: ContractSMSRequest = body;

      if (!phoneNumber || !clientName || !contractUrl) {
        console.error("SMS: Validation failed — need phoneNumber, clientName, contractUrl");
        throw new Error("Phone number, client name, and contract URL are required");
      }

      console.log("SMS: contractUrl " + contractUrl);
      const inferredPdfUrl = tryInferPdfUrlFromContractUrl(contractUrl);
      if (inferredPdfUrl) {
        console.log("SMS: inferred PDF URL " + inferredPdfUrl);
      } else if (contractUrl.includes("download-contract-pdf")) {
        console.log("SMS: contractUrl is direct PDF link");
      } else {
        console.log("SMS: no inferred PDF (not view-contract?token=...)");
      }

      const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
      const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
      const twilioPhone = Deno.env.get("TWILIO_PHONE_NUMBER");

      if (!accountSid || !authToken || !twilioPhone) {
        console.error("SMS: Missing TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_PHONE_NUMBER");
        throw new Error("Missing Twilio credentials");
      }

      console.log("SMS: Twilio env present (AccountSid " + accountSid.slice(0, 6) + "…)");

      const normalizedPhone = normalizePhoneNumber(phoneNumber);
      console.log("SMS: clientName " + clientName + " | isUpdate " + String(!!isUpdate));

      const totalText = contractTotal != null && !Number.isNaN(Number(contractTotal))
        ? ` ($${Number(contractTotal).toFixed(2)})`
        : "";
      let message = `Hi ${clientName}, your service agreement${totalText} is ready. View and download here: ${contractUrl}`;

      if (isUpdate) {
        message = `Hi ${clientName}, your service agreement${totalText} has been updated. View and download here: ${contractUrl}`;
      }

      console.log("SMS: preview " + message.substring(0, 100) + (message.length > 100 ? "…" : ""));

      const result = await sendContractSmsViaTwilio({
        accountSid,
        authToken,
        twilioPhone,
        to: normalizedPhone,
        body: message,
      });

      return new Response(
        JSON.stringify({ success: true, messageSid: result.sid }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        },
      );
    } catch (error: unknown) {
      Sentry.captureException(error);
      const msg = error instanceof Error ? error.message : "Internal server error";
      console.error("SMS: FAILURE —", msg);
      console.error("SMS:", error);
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
