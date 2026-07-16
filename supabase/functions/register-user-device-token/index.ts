import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RegisterTokenRequest {
  /** FCM registration token from the owner device. */
  token: string;
  platform: "ios" | "android" | "web";
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Authentication required" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { token: rawToken, platform }: RegisterTokenRequest = await req.json();
    const token = rawToken?.trim();
    if (!token || !platform) {
      return new Response(JSON.stringify({ error: "token and platform are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!["ios", "android", "web"].includes(platform)) {
      return new Response(JSON.stringify({ error: "platform must be ios, android or web" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const bearer = authHeader.replace("Bearer ", "");

    // Identify the owner from their session token.
    const supabaseUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await supabaseUser.auth.getUser(bearer);
    if (authErr || !user?.id) {
      return new Response(JSON.stringify({ error: "Invalid session" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, serviceKey);
    const now = new Date().toISOString();

    const { data: record, error: upsertError } = await supabase
      .from("user_device_tokens")
      .upsert(
        {
          user_id: user.id,
          token,
          platform,
          is_active: true,
          last_seen_at: now,
          updated_at: now,
        },
        { onConflict: "user_id,token", ignoreDuplicates: false },
      )
      .select("id, platform, is_active, last_seen_at")
      .single();

    if (upsertError) {
      console.error("Error upserting user device token:", upsertError);
      return new Response(JSON.stringify({ error: "Failed to register device token" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Keep only the latest token per platform active for this user.
    await supabase
      .from("user_device_tokens")
      .update({ is_active: false, updated_at: now })
      .eq("user_id", user.id)
      .eq("platform", platform)
      .neq("token", token)
      .eq("is_active", true);

    return new Response(JSON.stringify({ success: true, record }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Error in register-user-device-token:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
