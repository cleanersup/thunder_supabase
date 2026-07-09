import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RequestBody {
  employee_id: string;
  phone: string;
  /** Optional. Max rows to return (default 50). */
  limit?: number;
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
    const { employee_id, phone, limit } = body;

    if (!employee_id || !phone) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: employee_id, phone" }),
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

    const rowLimit = Math.min(Math.max(limit ?? 50, 1), 100);

    const { data, error } = await supabase
      .from("notifications")
      .select("id, title, message, type, read, created_at, related_id, related_type")
      .eq("employee_id", employee_id)
      .order("created_at", { ascending: false })
      .limit(rowLimit);

    if (error) {
      console.error("Error fetching employee notifications:", error);
      return new Response(
        JSON.stringify({ error: "Failed to fetch notifications" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ success: true, notifications: data ?? [] }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Error in get-employee-notifications:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
