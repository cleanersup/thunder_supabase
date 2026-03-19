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

interface ValidatePhoneRequest {
  phoneNumber: string;
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
    Sentry.setTag("function", "validate-employee-phone");

    // Handle CORS preflight requests
    if (req.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    console.log("=== validate-employee-phone FUNCTION TRIGGERED ===");
    console.log("Timestamp:", new Date().toISOString());
    console.log("Request method:", req.method);
    console.log("Request URL:", req.url);

    try {
      const body = await req.json();
      console.log("Request body:", JSON.stringify(body, null, 2));

      const { phoneNumber } = body as ValidatePhoneRequest;
      const lookupPhone = normalizePhoneForLookup(phoneNumber);

      console.log("Raw phoneNumber:", phoneNumber);
      console.log("Normalized phone:", lookupPhone);

      if (!phoneNumber) {
        console.error('❌ Phone number is missing from request');
        return new Response(
          JSON.stringify({ error: 'Phone number is required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Initialize Supabase client with service role key
      const supabaseUrl = Deno.env.get('SUPABASE_URL');
      const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

      console.log("SUPABASE_URL:", supabaseUrl ? "✅ Set" : "❌ Missing");
      console.log("SUPABASE_SERVICE_ROLE_KEY:", supabaseKey ? "✅ Set" : "❌ Missing");

      if (!supabaseUrl || !supabaseKey) {
        console.error("❌ Missing Supabase environment variables");
        throw new Error("Supabase credentials not configured");
      }

      const supabase = createClient(supabaseUrl, supabaseKey);
      console.log("✅ Supabase client created successfully");

      // Find all active employees with this phone number
      console.log("=== CHECKING ACTIVE EMPLOYEES ===");
      console.log("Querying employees with phone:", lookupPhone);

      // Query 1: Get all active employees with this phone number
      const { data: employees, error: employeeError } = await supabase
        .from('employees')
        .select('id, first_name, last_name, phone, user_id')
        .eq('phone', lookupPhone)
        .eq('status', 'active');

      if (employeeError) {
        console.error('❌ Error checking employees:', employeeError);
        console.error("Error details:", JSON.stringify(employeeError, null, 2));
        return new Response(
          JSON.stringify({ error: 'Error checking employee records' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (!employees || employees.length === 0) {
        console.log("❌ No active employees found with phone number:", phoneNumber);
        return new Response(
          JSON.stringify({ error: 'No active employee found with this phone number' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log(`✅ Found ${employees.length} active employee(s)`);

      // Query 2: Get profiles for all unique user_ids (separate query to avoid FK relationship requirement)
      const userIds = [...new Set(employees.map(emp => emp.user_id))];
      console.log("Fetching profiles for user_ids:", userIds);

      const { data: profiles, error: profileError } = await supabase
        .from('profiles')
        .select('user_id, company_name, company_logo')
        .in('user_id', userIds);

      if (profileError) {
        console.error('⚠️ Error fetching profiles (non-fatal):', profileError);
      }

      console.log(`✅ Fetched ${profiles?.length || 0} profile(s)`);

      // Manual join: Create a map for O(1) profile lookup
      const profileMap = new Map();
      if (profiles) {
        profiles.forEach(profile => {
          profileMap.set(profile.user_id, profile);
        });
      }

      // Transform to response format by combining employee and profile data
      const companies = employees.map(emp => {
        const profile = profileMap.get(emp.user_id);

        return {
          employee_id: emp.id,
          user_id: emp.user_id,
          company_name: profile?.company_name || 'Company',
          company_logo: profile?.company_logo || null,
          employee_name: `${emp.first_name} ${emp.last_name}`
        };
      });

      console.log("Companies found:", companies.length);
      companies.forEach((company, idx) => {
        console.log(`[${idx + 1}] ${company.company_name} (${company.user_id})`);
      });

      Sentry.addBreadcrumb({
        message: `Found ${companies.length} companies for phone`,
        level: "info"
      });

      return new Response(
        JSON.stringify({
          success: true,
          companies: companies
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );

    } catch (error) {
      Sentry.captureException(error);
      console.error("=== ❌ ERROR IN validate-employee-phone FUNCTION ===");
      console.error("Error message:", error instanceof Error ? error.message : String(error));
      console.error("Error stack:", error instanceof Error ? error.stack : "No stack trace");

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
