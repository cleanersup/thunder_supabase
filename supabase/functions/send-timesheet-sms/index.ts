import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface TimesheetSMSRequest {
  phoneNumber: string;
  employeeName: string;
  pdfUrl: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  console.log("=== send-timesheet-sms FUNCTION TRIGGERED ===");
  console.log("Timestamp:", new Date().toISOString());
  console.log("Request method:", req.method);
  console.log("Request URL:", req.url);

  try {
    const body = await req.json();
    console.log("=== REQUEST BODY RECEIVED ===");
    console.log("Full body:", JSON.stringify(body, null, 2));
    
    const { phoneNumber, employeeName, pdfUrl }: TimesheetSMSRequest = body;

    console.log("=== EXTRACTED REQUEST PARAMETERS ===");
    console.log("Phone number:", phoneNumber);
    console.log("Phone number type:", typeof phoneNumber);
    console.log("Phone number length:", phoneNumber?.length);
    console.log("Employee name:", employeeName);
    console.log("PDF URL:", pdfUrl);
    console.log("PDF URL length:", pdfUrl?.length);

    // Validate required parameters
    if (!phoneNumber) {
      console.error("❌ Phone number is missing");
      throw new Error('Phone number is required');
    }
    if (!employeeName) {
      console.error("❌ Employee name is missing");
      throw new Error('Employee name is required');
    }
    if (!pdfUrl) {
      console.error("❌ PDF URL is missing");
      throw new Error('PDF URL is required');
    }

    console.log("=== CHECKING TWILIO CREDENTIALS ===");
    const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID');
    const authToken = Deno.env.get('TWILIO_AUTH_TOKEN');
    const twilioPhone = Deno.env.get('TWILIO_PHONE_NUMBER');

    console.log("TWILIO_ACCOUNT_SID:", accountSid ? "✅ Set (starts with: " + accountSid.substring(0, 4) + "...)" : "❌ Missing");
    console.log("TWILIO_AUTH_TOKEN:", authToken ? "✅ Set (length: " + authToken.length + ")" : "❌ Missing");
    console.log("TWILIO_PHONE_NUMBER:", twilioPhone ? "✅ Set (" + twilioPhone + ")" : "❌ Missing");

    if (!accountSid || !authToken || !twilioPhone) {
      console.error("❌ Missing Twilio credentials");
      console.error("Missing:", {
        accountSid: !accountSid,
        authToken: !authToken,
        phoneNumber: !twilioPhone
      });
      throw new Error('Missing Twilio credentials');
    }

    console.log("✅ All Twilio credentials present");

    const message = `Hi ${employeeName}, your timesheet is ready. View it here: ${pdfUrl}`;
    console.log("=== PREPARING SMS MESSAGE ===");
    console.log("Message:", message);
    console.log("Message length:", message.length, "characters");
    console.log("Recipient phone:", phoneNumber);
    console.log("From phone:", twilioPhone);

    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
    console.log("Twilio API URL:", twilioUrl);

    const requestBody = {
      To: phoneNumber,
      From: twilioPhone,
      Body: message,
    };
    console.log("=== SENDING SMS VIA TWILIO ===");
    console.log("Request body:", requestBody);

    const requestStartTime = Date.now();
    const response = await fetch(twilioUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': 'Basic ' + btoa(`${accountSid}:${authToken}`),
        },
      body: new URLSearchParams(requestBody),
    });

    const requestDuration = Date.now() - requestStartTime;
    console.log("Twilio API response received in", requestDuration, "ms");
    console.log("Response status:", response.status, response.statusText);
    console.log("Response headers:", Object.fromEntries(response.headers.entries()));

    const data = await response.json();
    console.log("Twilio API response body:", JSON.stringify(data, null, 2));

    if (!response.ok) {
      console.error('❌ Twilio API error response:');
      console.error("Status:", response.status);
      console.error("Error data:", JSON.stringify(data, null, 2));
      console.error("Error message:", data.message || data.error_message || "Unknown error");
      throw new Error(data.message || data.error_message || 'Failed to send SMS');
    }

    console.log("✅ SMS sent successfully!");
    console.log("Message SID:", data.sid);
    console.log("Message status:", data.status);
    console.log("Message price:", data.price);
    console.log("Message price unit:", data.price_unit);

    return new Response(
      JSON.stringify({ success: true, messageSid: data.sid }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error: any) {
    console.error("=== ❌ ERROR IN send-timesheet-sms FUNCTION ===");
    console.error("Error message:", error?.message || String(error));
    console.error("Error stack:", error?.stack || "No stack trace");
    console.error("Error details:", JSON.stringify(error, Object.getOwnPropertyNames(error), 2));
    console.error("Error type:", error?.constructor?.name || typeof error);
    
    return new Response(
      JSON.stringify({ 
        error: error?.message || 'Internal server error',
        stack: error?.stack
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});
