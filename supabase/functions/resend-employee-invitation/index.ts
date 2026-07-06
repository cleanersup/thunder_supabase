import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ResendRequest {
  employeeId: string;
}

// Re-invoke an existing invitation function with the DB-webhook-style payload.
async function invokeInvitationFn(
  fnName: string,
  record: Record<string, unknown>,
  supabaseUrl: string,
  serviceKey: string,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const resp = await fetch(`${supabaseUrl}/functions/v1/${fnName}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceKey}`,
    },
    body: JSON.stringify({ type: "INSERT", table: "employees", schema: "public", record }),
  });
  const body = await resp.json().catch(() => ({}));
  return { ok: resp.ok, status: resp.status, body };
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

    const { employeeId }: ResendRequest = await req.json();
    if (!employeeId) {
      return new Response(JSON.stringify({ error: "employeeId is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const token = authHeader.replace("Bearer ", "");

    // Authenticate the caller (the owner).
    const supabaseUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await supabaseUser.auth.getUser(token);
    if (authErr || !user?.id) {
      return new Response(JSON.stringify({ error: "Invalid session" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceKey);

    const { data: employee, error: empErr } = await supabaseAdmin
      .from("employees")
      .select("id, first_name, last_name, phone, email, user_id")
      .eq("id", employeeId)
      .maybeSingle();

    if (empErr || !employee) {
      return new Response(JSON.stringify({ error: "Employee not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Only the owner of this employee may resend the invitation.
    if (employee.user_id !== user.id) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const record = {
      id: employee.id,
      first_name: employee.first_name,
      last_name: employee.last_name,
      phone: employee.phone,
      email: employee.email,
      user_id: employee.user_id,
    };

    // Re-send SMS (skipped internally if no phone) and email (skipped if no email).
    const smsResult = employee.phone
      ? await invokeInvitationFn("send-employee-sms", record, supabaseUrl, serviceKey)
      : { ok: false, status: 0, body: { skipped: "no_phone" } };

    const emailResult = await invokeInvitationFn(
      "send-employee-welcome-email",
      record,
      supabaseUrl,
      serviceKey,
    );

    return new Response(
      JSON.stringify({
        success: true,
        sms: employee.phone ? (smsResult.ok ? "sent" : "failed") : "skipped",
        email: employee.email ? (emailResult.ok ? "sent" : "failed") : "skipped",
        // Surface the underlying reason so failures are debuggable from the client.
        smsDetail: employee.phone && !smsResult.ok
          ? { status: smsResult.status, body: smsResult.body }
          : undefined,
        emailDetail: employee.email && !emailResult.ok
          ? { status: emailResult.status, body: emailResult.body }
          : undefined,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Error in resend-employee-invitation:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
