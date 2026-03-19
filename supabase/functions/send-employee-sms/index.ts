import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface WebhookPayload {
  type: 'INSERT';
  table: string;
  record: {
    id: string;
    first_name: string;
    last_name: string;
    phone: string;
    user_id: string;
  };
  schema: string;
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

const handler = async (req: Request): Promise<Response> => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  console.log("=== send-employee-sms FUNCTION TRIGGERED ===");
  console.log("Timestamp:", new Date().toISOString());
  console.log("Request method:", req.method);
  console.log("Request URL:", req.url);

  try {
    const payload: WebhookPayload = await req.json();

    console.log("=== WEBHOOK PAYLOAD RECEIVED ===");
    console.log("Payload type:", payload.type);
    console.log("Payload table:", payload.table);
    console.log("Payload record:", JSON.stringify(payload.record, null, 2));

    // Only process INSERT events for employees table
    if (payload.type !== 'INSERT' || payload.table !== 'employees') {
      console.log("⚠️ Skipping: Not an employee INSERT event");
      console.log("Event type:", payload.type, "Table:", payload.table);
      return new Response(
        JSON.stringify({ message: "Not an employee insert event" }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const employee = payload.record;
    console.log("=== PROCESSING EMPLOYEE ===");
    console.log("Employee ID:", employee.id);
    console.log("Employee name:", `${employee.first_name} ${employee.last_name}`);
    console.log("Employee phone (raw):", employee.phone);
    console.log("Employee user_id:", employee.user_id);

    // Validate phone number exists
    if (!employee.phone) {
      console.log("❌ Employee has no phone number, skipping SMS");
      return new Response(
        JSON.stringify({ message: "No phone number provided" }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Get company name from profiles table
    console.log("=== CHECKING ENVIRONMENT VARIABLES ===");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    console.log("SUPABASE_URL:", supabaseUrl ? "✅ Set" : "❌ Missing");
    console.log("SUPABASE_SERVICE_ROLE_KEY:", supabaseServiceKey ? "✅ Set (length: " + supabaseServiceKey.length + ")" : "❌ Missing");

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error("❌ Missing Supabase environment variables");
      throw new Error("Supabase credentials not configured");
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    console.log("Supabase client created successfully");

    console.log("=== FETCHING COMPANY PROFILE ===");
    console.log("Querying profiles for user_id:", employee.user_id);

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('company_name')
      .eq('user_id', employee.user_id)
      .single();

    if (profileError) {
      console.error("❌ Error fetching company profile:", profileError);
      console.error("Profile error details:", JSON.stringify(profileError, null, 2));
    } else {
      console.log("✅ Profile fetched successfully");
      console.log("Company name:", profile?.company_name || "not set");
    }

    const companyName = profile?.company_name || "the";
    console.log("Using company name:", companyName);

    // Get Twilio credentials
    console.log("=== CHECKING TWILIO CREDENTIALS ===");
    const twilioAccountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
    const twilioAuthToken = Deno.env.get("TWILIO_AUTH_TOKEN");
    const twilioPhoneNumber = Deno.env.get("TWILIO_PHONE_NUMBER");

    console.log("TWILIO_ACCOUNT_SID:", twilioAccountSid ? "✅ Set (starts with: " + twilioAccountSid.substring(0, 4) + "...)" : "❌ Missing");
    console.log("TWILIO_AUTH_TOKEN:", twilioAuthToken ? "✅ Set (length: " + twilioAuthToken.length + ")" : "❌ Missing");
    console.log("TWILIO_PHONE_NUMBER:", twilioPhoneNumber ? "✅ Set (" + twilioPhoneNumber + ")" : "❌ Missing");

    if (!twilioAccountSid || !twilioAuthToken || !twilioPhoneNumber) {
      console.error("❌ Twilio credentials not configured");
      console.error("Missing:", {
        accountSid: !twilioAccountSid,
        authToken: !twilioAuthToken,
        phoneNumber: !twilioPhoneNumber
      });
      throw new Error("Twilio credentials not configured");
    }

    console.log("✅ All Twilio credentials present");

    // Normalize phone number
    const normalizedPhone = normalizePhoneNumber(employee.phone);
    console.log("=== PHONE NUMBER NORMALIZATION ===");
    console.log("Original phone:", employee.phone);
    console.log("Normalized phone:", normalizedPhone);

    // Prepare SMS message with company name
    console.log("=== PREPARING SMS MESSAGE ===");
    const appUrl = Deno.env.get("PUBLIC_APP_URL") || Deno.env.get("APP_URL") || "https://app.staging.thunderpro.co";
    const dashboardUrl = `${appUrl}/employee/login`;
    console.log("Dashboard URL:", dashboardUrl);
    const message = `Hi ${employee.first_name}! Welcome to the ${companyName} team. Access your employee dashboard here: ${dashboardUrl}\n\nYou can clock in/out and manage your time from this link.`;

    console.log("Message preview:", message.substring(0, 100) + "...");
    console.log("Message length:", message.length, "characters");
    console.log("Recipient phone:", normalizedPhone);
    console.log("From phone:", twilioPhoneNumber);

    // Send SMS via Twilio
    console.log("=== SENDING SMS VIA TWILIO ===");
    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${twilioAccountSid}/Messages.json`;
    console.log("Twilio API URL:", twilioUrl);

    const formData = new URLSearchParams();
    formData.append("To", normalizedPhone);
    formData.append("From", twilioPhoneNumber);
    formData.append("Body", message);

    console.log("Request body:", {
      To: normalizedPhone,
      From: twilioPhoneNumber,
      Body: message.substring(0, 50) + "..."
    });

    console.log("Making Twilio API request...");
    const requestStartTime = Date.now();

    const twilioResponse = await fetch(twilioUrl, {
      method: "POST",
      headers: {
        "Authorization": "Basic " + btoa(`${twilioAccountSid}:${twilioAuthToken}`),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formData.toString(),
    });

    const requestDuration = Date.now() - requestStartTime;
    console.log("Twilio API response received in", requestDuration, "ms");
    console.log("Response status:", twilioResponse.status, twilioResponse.statusText);
    console.log("Response headers:", Object.fromEntries(twilioResponse.headers.entries()));

    if (!twilioResponse.ok) {
      const errorText = await twilioResponse.text();
      console.error("❌ Twilio API error response:");
      console.error("Status:", twilioResponse.status);
      console.error("Error body:", errorText);
      try {
        const errorJson = JSON.parse(errorText);
        console.error("Parsed error:", JSON.stringify(errorJson, null, 2));
      } catch (e) {
        console.error("Could not parse error as JSON");
      }
      throw new Error(`Twilio API error: ${errorText}`);
    }

    const twilioData = await twilioResponse.json();
    console.log("✅ SMS sent successfully!");
    console.log("Twilio response:", JSON.stringify(twilioData, null, 2));
    console.log("Message SID:", twilioData.sid);
    console.log("Message status:", twilioData.status);

    return new Response(
      JSON.stringify({
        success: true,
        message: "SMS sent successfully",
        companyName: companyName,
        twilioResponse: twilioData
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  } catch (error: any) {
    console.error("=== ❌ ERROR IN send-employee-sms FUNCTION ===");
    console.error("Error message:", error.message);
    console.error("Error stack:", error.stack);
    console.error("Error details:", JSON.stringify(error, Object.getOwnPropertyNames(error), 2));
    console.error("Error type:", error.constructor.name);

    return new Response(
      JSON.stringify({
        error: error.message,
        details: error.toString(),
        stack: error.stack
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
};

serve(handler);
