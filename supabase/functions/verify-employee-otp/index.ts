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

interface VerifyOTPRequest {
  phoneNumber: string;
  otpCode: string;
}

const handler = async (req: Request): Promise<Response> => {
  return await Sentry.withScope(async (scope) => {
    Sentry.setTag("function", "verify-employee-otp");

    // Handle CORS preflight requests
    if (req.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      const { phoneNumber, otpCode }: VerifyOTPRequest = await req.json();

      if (!phoneNumber || !otpCode) {
        return new Response(
          JSON.stringify({ error: 'Phone number and OTP code are required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Initialize Supabase client with service role key
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const supabase = createClient(supabaseUrl, supabaseKey);

      // Rate limiting: Check total failed attempts in the last hour
      const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
      const { data: failedAttempts, error: attemptError } = await supabase
        .from('otp_codes')
        .select('attempts')
        .eq('phone_number', phoneNumber)
        .gte('created_at', oneHourAgo)
        .gte('attempts', 3);

      if (failedAttempts && failedAttempts.length >= 3) {
        console.log(`Account locked for ${phoneNumber} due to too many failed attempts`);
        return new Response(
          JSON.stringify({
            error: 'Too many failed verification attempts. Please try again in 1 hour or request a new code.',
            verified: false
          }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Find the most recent non-verified OTP for this phone number
      const { data: otpRecord, error: otpError } = await supabase
        .from('otp_codes')
        .select('*')
        .eq('phone_number', phoneNumber)
        .eq('otp_code', otpCode)
        .eq('verified', false)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (otpError) {
        console.error('Error checking OTP:', otpError);
        return new Response(
          JSON.stringify({ error: 'Error verifying OTP code' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (!otpRecord) {
        // Increment attempts for wrong OTP codes
        const { data: wrongOTPs } = await supabase
          .from('otp_codes')
          .select('*')
          .eq('phone_number', phoneNumber)
          .eq('verified', false)
          .gt('expires_at', new Date().toISOString())
          .order('created_at', { ascending: false });

        if (wrongOTPs && wrongOTPs.length > 0) {
          for (const wrongOTP of wrongOTPs) {
            await supabase
              .from('otp_codes')
              .update({ attempts: wrongOTP.attempts + 1 })
              .eq('id', wrongOTP.id);
          }
        }

        console.log(`Invalid OTP attempt for ${phoneNumber}`);
        return new Response(
          JSON.stringify({
            error: 'Invalid or expired OTP code',
            verified: false
          }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Check if too many attempts
      if (otpRecord.attempts >= 5) {
        return new Response(
          JSON.stringify({
            error: 'Too many verification attempts. Please request a new code.',
            verified: false
          }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Mark OTP as verified
      const { error: updateError } = await supabase
        .from('otp_codes')
        .update({ verified: true })
        .eq('id', otpRecord.id);

      if (updateError) {
        console.error('Error updating OTP:', updateError);
        return new Response(
          JSON.stringify({ error: 'Error completing verification' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Get employee data
      const { data: employee, error: employeeError } = await supabase
        .from('employees')
        .select('id, first_name, last_name, phone, email, position, status, hourly_pay, address, user_id')
        .eq('id', otpRecord.employee_id)
        .single();

      if (employeeError || !employee) {
        console.error('Error fetching employee:', employeeError);
        return new Response(
          JSON.stringify({ error: 'Employee not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      Sentry.setUser({ id: employee.id, email: employee.email || undefined });
      Sentry.addBreadcrumb({ message: "OTP verified successfully", level: "info" });
      console.log(`OTP verified successfully for employee ${employee.first_name} ${employee.last_name}`);

      return new Response(
        JSON.stringify({
          verified: true,
          employee: {
            id: employee.id,
            firstName: employee.first_name,
            lastName: employee.last_name,
            phone: employee.phone,
            email: employee.email,
            position: employee.position,
            status: employee.status,
            hourlyPay: employee.hourly_pay,
            address: employee.address,
            userId: employee.user_id
          }
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );

    } catch (error) {
      Sentry.captureException(error);
      console.error('Error in verify-employee-otp:', error);
      const errorMessage = error instanceof Error ? error.message : 'Internal server error';
      return new Response(
        JSON.stringify({ error: errorMessage }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
  });
};

serve(handler);
