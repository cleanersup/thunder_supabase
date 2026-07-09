import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RequestBody {
  employee_id: string;
  phone: string;
  notification_id: string;
}

async function verifyEmployee(
  supabase: ReturnType<typeof createClient>,
  employeeId: string,
  phone: string,
) {
  const { data: employee, error } = await supabase
    .from("employees")
    .select("id")
    .eq("id", employeeId)
    .eq("phone", phone)
    .maybeSingle();

  if (error || !employee) {
    return null;
  }
  return employee;
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

    const body: RequestBody = await req.json();
    const { employee_id, phone, notification_id } = body;

    if (!employee_id || !phone || !notification_id) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: employee_id, phone, notification_id" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const employee = await verifyEmployee(supabase, employee_id, phone);
    if (!employee) {
      return new Response(
        JSON.stringify({ error: "Employee not found or phone number does not match" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data, error } = await supabase
      .from("notifications")
      .update({ read: true })
      .eq("id", notification_id)
      .eq("employee_id", employee_id)
      .select("id, read")
      .maybeSingle();

    if (error) {
      console.error("Error marking notification read:", error);
      return new Response(
        JSON.stringify({ error: "Failed to update notification" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!data) {
      return new Response(
        JSON.stringify({ error: "Notification not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ success: true, notification: data }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Error in mark-employee-notification-read:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
