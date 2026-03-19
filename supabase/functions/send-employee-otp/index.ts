import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
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

interface SendOTPRequest {
  phoneNumber: string;
  user_id?: string;      // Optional: filter by company
  employee_id?: string;  // Optional: specific employee ID
}

// Normalize phone just for employee lookup so it matches how it's stored in DB
// Example: "+1 (773) 658-5587" -> "7736585587"
const normalizePhoneForLookup = (phone: string): string => {
  if (!phone) return phone;
  // Keep only digits
  const digits = phone.replace(/\D/g, '');
  // If it's 11 digits and starts with 1 (US country code), drop the leading 1
  if (digits.length === 11 && digits.startsWith('1')) {
    return digits.slice(1);
  }
  return digits;
};

const handler = async (req: Request): Promise<Response> => {
  return await Sentry.withScope(async (scope) => {
    Sentry.setTag("function", "send-employee-otp");

    // Handle CORS preflight requests
    if (req.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    console.log("=== send-employee-otp FUNCTION TRIGGERED ===");
    console.log("Timestamp:", new Date().toISOString());
    console.log("Request method:", req.method);
    console.log("Request URL:", req.url);

    try {
      // Read body once and store in variable
      const body = await req.json();
      console.log("=== REQUEST BODY RECEIVED ===");
      console.log("Full body:", JSON.stringify(body, null, 2));

      const { phoneNumber, user_id, employee_id } = body;
      const lookupPhone = normalizePhoneForLookup(phoneNumber);
      Sentry.addBreadcrumb({ message: "Phone number extracted from request", level: "info" });
      console.log("=== PHONE NUMBER EXTRACTION ===");
      console.log("[OTP] Raw phoneNumber from request:", phoneNumber);
      console.log("[OTP] Normalized phone for DB lookup:", lookupPhone);
      console.log("[OTP] user_id (optional):", user_id || "not provided");
      console.log("[OTP] employee_id (optional):", employee_id || "not provided");
      console.log("Phone number type:", typeof phoneNumber);
      console.log("Phone number length:", phoneNumber?.length);

      if (!phoneNumber) {
        console.error('❌ Phone number is missing from request');
        return new Response(
          JSON.stringify({ error: 'Phone number is required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Initialize Supabase client with service role key
      console.log("=== CHECKING ENVIRONMENT VARIABLES ===");
      const supabaseUrl = Deno.env.get('SUPABASE_URL');
      const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

      console.log("SUPABASE_URL:", supabaseUrl ? "✅ Set" : "❌ Missing");
      console.log("SUPABASE_SERVICE_ROLE_KEY:", supabaseKey ? "✅ Set (length: " + supabaseKey.length + ")" : "❌ Missing");

      if (!supabaseUrl || !supabaseKey) {
        console.error("❌ Missing Supabase environment variables");
        throw new Error("Supabase credentials not configured");
      }

      const supabase = createClient(supabaseUrl, supabaseKey);
      console.log("✅ Supabase client created successfully");

      // Rate limiting: Check if an OTP was sent recently (within last 60 seconds)
      console.log("=== CHECKING RATE LIMIT ===");
      console.log("[OTP] Checking recent OTPs for phone_number (raw):", phoneNumber);

      const { data: recentOTP, error: recentOTPError } = await supabase
        .from('otp_codes')
        .select('created_at')
        .eq('phone_number', phoneNumber)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (recentOTPError) {
        console.log("⚠️ Error checking rate limit (non-fatal):", recentOTPError);
      }

      if (recentOTP && !recentOTPError) {
        const timeSinceLastOTP = Date.now() - new Date(recentOTP.created_at).getTime();
        console.log("Last OTP sent:", new Date(recentOTP.created_at).toISOString());
        console.log("Time since last OTP:", timeSinceLastOTP, "ms");

        if (timeSinceLastOTP < 60000) { // 60 seconds
          const waitTime = Math.ceil((60000 - timeSinceLastOTP) / 1000);
          console.log(`⏱️ Rate limit hit for ${phoneNumber}. Must wait ${waitTime} more seconds.`);
          return new Response(
            JSON.stringify({
              error: `Please wait ${waitTime} seconds before requesting another code`,
              retryAfter: waitTime
            }),
            { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      } else {
        console.log("✅ No rate limit - proceeding with OTP generation");
      }

      // Check if employee exists with this phone number
      console.log("=== CHECKING EMPLOYEE EXISTS ===");
      console.log("[OTP] Querying employees table with phone (normalized):", lookupPhone);

      // Build query - add user_id filter if provided for multi-company support
      let employeeQuery = supabase
        .from('employees')
        .select('id, first_name, last_name, phone, user_id')
        .eq('phone', lookupPhone)
        .eq('status', 'active');

      // If user_id is provided, filter by it (for multi-company employees)
      if (user_id) {
        console.log("[OTP] Filtering by user_id:", user_id);
        employeeQuery = employeeQuery.eq('user_id', user_id);
      }

      // If employee_id is provided, use it directly (most specific)
      if (employee_id) {
        console.log("[OTP] Filtering by employee_id:", employee_id);
        employeeQuery = employeeQuery.eq('id', employee_id);
      }

      const { data: employee, error: employeeError } = await employeeQuery.maybeSingle();

      if (employeeError) {
        console.error('❌ Error checking employee:', employeeError);
        console.error("Employee error details:", JSON.stringify(employeeError, null, 2));
        return new Response(
          JSON.stringify({ error: 'Error verifying employee' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (!employee) {
        console.log("❌ No active employee found with phone number:", phoneNumber);
        return new Response(
          JSON.stringify({ error: 'No active employee found with this phone number' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      Sentry.setUser({ id: employee.id });
      Sentry.addBreadcrumb({ message: "Employee found in database", level: "info" });
      console.log("✅ Employee found for OTP login:");
      console.log("[OTP] Employee ID:", employee.id);
      console.log("[OTP] Employee name:", `${employee.first_name} ${employee.last_name}`);
      console.log("[OTP] Employee phone in DB:", employee.phone);

      // Generate 6-digit OTP code
      console.log("=== GENERATING OTP CODE ===");
      const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
      console.log("Generated OTP code:", otpCode);

      // Set expiration to 10 minutes from now
      const expiresAt = new Date();
      expiresAt.setMinutes(expiresAt.getMinutes() + 10);
      console.log("OTP expires at:", expiresAt.toISOString());

      // Save OTP to database
      console.log("=== SAVING OTP TO DATABASE ===");
      const { error: otpError } = await supabase
        .from('otp_codes')
        .insert({
          phone_number: phoneNumber,
          otp_code: otpCode,
          employee_id: employee.id,
          expires_at: expiresAt.toISOString(),
        });

      if (otpError) {
        console.error('❌ Error saving OTP:', otpError);
        console.error("OTP error details:", JSON.stringify(otpError, null, 2));
        return new Response(
          JSON.stringify({ error: 'Error generating OTP code' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log("✅ OTP saved to database successfully");

      // Send SMS via Twilio
      console.log("=== CHECKING TWILIO CREDENTIALS ===");
      const twilioAccountSid = Deno.env.get('TWILIO_ACCOUNT_SID');
      const twilioAuthToken = Deno.env.get('TWILIO_AUTH_TOKEN');
      const twilioPhoneNumber = Deno.env.get('TWILIO_PHONE_NUMBER');

      console.log("TWILIO_ACCOUNT_SID:", twilioAccountSid ? "✅ Set (starts with: " + twilioAccountSid.substring(0, 4) + "...)" : "❌ Missing");
      console.log("TWILIO_AUTH_TOKEN:", twilioAuthToken ? "✅ Set (length: " + twilioAuthToken.length + ")" : "❌ Missing");
      console.log("TWILIO_PHONE_NUMBER:", twilioPhoneNumber ? "✅ Set (" + twilioPhoneNumber + ")" : "❌ Missing");

      if (!twilioAccountSid || !twilioAuthToken || !twilioPhoneNumber) {
        console.error('❌ Twilio credentials not configured');
        console.error("Missing:", {
          accountSid: !twilioAccountSid,
          authToken: !twilioAuthToken,
          phoneNumber: !twilioPhoneNumber
        });
        return new Response(
          JSON.stringify({ error: 'SMS service not configured' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log("✅ All Twilio credentials present");

      const message = `Your verification code is: ${otpCode}. This code will expire in 10 minutes.`;
      console.log("=== PREPARING SMS MESSAGE ===");
      console.log("Message:", message);
      console.log("Message length:", message.length, "characters");
      console.log("Recipient phone:", phoneNumber);
      console.log("From phone:", twilioPhoneNumber);

      const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${twilioAccountSid}/Messages.json`;
      const twilioAuth = btoa(`${twilioAccountSid}:${twilioAuthToken}`);
      console.log("Twilio API URL:", twilioUrl);

      Sentry.addBreadcrumb({ message: "Sending SMS via Twilio", level: "info" });
      console.log("=== SENDING SMS VIA TWILIO ===");
      console.log("[OTP] Twilio request body:", {
        To: phoneNumber,
        From: twilioPhoneNumber,
        BodyPreview: message.substring(0, 50) + (message.length > 50 ? "..." : "")
      });

      const requestStartTime = Date.now();
      const twilioResponse = await fetch(twilioUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${twilioAuth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          To: phoneNumber,
          From: twilioPhoneNumber,
          Body: message,
        }),
      });

      const requestDuration = Date.now() - requestStartTime;
      console.log("[OTP] Twilio API response received in", requestDuration, "ms");
      console.log("[OTP] Twilio response status:", twilioResponse.status, twilioResponse.statusText);
      console.log("Response headers:", Object.fromEntries(twilioResponse.headers.entries()));

      if (!twilioResponse.ok) {
        const twilioError = await twilioResponse.text();
        console.error('❌ [OTP] Twilio API error response:');
        console.error("[OTP] Status:", twilioResponse.status);
        console.error("[OTP] Error body:", twilioError);
        try {
          const errorJson = JSON.parse(twilioError);
          console.error("[OTP] Parsed Twilio error JSON:", JSON.stringify(errorJson, null, 2));
        } catch (e) {
          console.error("[OTP] Could not parse Twilio error as JSON");
        }
        return new Response(
          JSON.stringify({ error: 'Failed to send SMS' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const twilioData = await twilioResponse.json();
      console.log("✅ [OTP] SMS sent successfully via Twilio");
      console.log("[OTP] Twilio raw response:", JSON.stringify(twilioData, null, 2));
      console.log("[OTP] Twilio Message SID:", twilioData.sid);
      console.log("[OTP] Twilio Message status:", twilioData.status);
      console.log(`✅ [OTP] Code sent to phoneNumber (raw): ${phoneNumber} for employee ${employee.first_name} ${employee.last_name}`);

      return new Response(
        JSON.stringify({
          success: true,
          message: 'OTP code sent successfully',
          expiresAt: expiresAt.toISOString()
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );

    } catch (error) {
      Sentry.captureException(error);
      console.error("=== ❌ ERROR IN send-employee-otp FUNCTION ===");
      console.error("Error message:", error instanceof Error ? error.message : String(error));
      console.error("Error stack:", error instanceof Error ? error.stack : "No stack trace");
      console.error("Error details:", JSON.stringify(error, Object.getOwnPropertyNames(error), 2));
      console.error("Error type:", error?.constructor?.name || typeof error);

      const errorMessage = error instanceof Error ? error.message : 'Internal server error';
      return new Response(
        JSON.stringify({
          error: errorMessage,
          stack: error instanceof Error ? error.stack : undefined
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
  });
};

serve(handler);