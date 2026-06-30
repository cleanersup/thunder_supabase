import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RegisterTokenRequest {
  employee_id: string;
  phone: string;
  /** FCM registration token (Android) or APNs device token (iOS). */
  token: string;
  platform: "ios" | "android" | "web";
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body: RegisterTokenRequest = await req.json();
    const { employee_id, phone, token, platform } = body;

    // ── Validate ──────────────────────────────────────────────────────────────
    if (!employee_id || !phone || !token || !platform) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: employee_id, phone, token, platform" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const validPlatforms = ["ios", "android", "web"];
    if (!validPlatforms.includes(platform)) {
      return new Response(
        JSON.stringify({ error: `platform must be one of: ${validPlatforms.join(", ")}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Authenticate employee ─────────────────────────────────────────────────
    const { data: employee, error: empError } = await supabase
      .from("employees")
      .select("id, user_id, phone")
      .eq("id", employee_id)
      .eq("phone", phone)
      .maybeSingle();

    if (empError || !employee) {
      return new Response(
        JSON.stringify({ error: "Employee not found or phone number does not match" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const now = new Date().toISOString();

    // ── Upsert device token ───────────────────────────────────────────────────
    // If the same token already exists for this employee, update last_seen_at + platform.
    // This handles app reinstalls and token refreshes gracefully.
    const { data: record, error: upsertError } = await supabase
      .from("employee_device_tokens")
      .upsert(
        {
          employee_id,
          user_id: employee.user_id,
          token,
          platform,
          is_active: true,
          last_seen_at: now,
          updated_at: now,
        },
        {
          onConflict: "employee_id,token",
          ignoreDuplicates: false,
        },
      )
      .select("id, employee_id, platform, is_active, last_seen_at")
      .single();

    if (upsertError) {
      console.error("Error upserting device token:", upsertError);
      return new Response(
        JSON.stringify({ error: "Failed to register device token" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Deactivate stale tokens for the same employee on the same platform
    // (keeps only the latest token per platform active).
    await supabase
      .from("employee_device_tokens")
      .update({ is_active: false, updated_at: now })
      .eq("employee_id", employee_id)
      .eq("platform", platform)
      .neq("token", token)
      .eq("is_active", true);

    console.log(`Device token registered for employee ${employee_id} (${platform})`);

    return new Response(
      JSON.stringify({ success: true, record }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("Unexpected error in register-device-token:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
