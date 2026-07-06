import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendPushToEmployees, type PushMessage } from "../_shared/fcm.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface PushRequest {
  /** One employee ID (convenience) … */
  employee_id?: string;
  /** … or several at once. */
  employee_ids?: string[];
  title: string;
  body: string;
  /** Optional string map delivered with the push. */
  data?: Record<string, string>;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { employee_id, employee_ids, title, body, data }: PushRequest = await req.json();

    const ids = [
      ...(employee_id ? [employee_id] : []),
      ...(Array.isArray(employee_ids) ? employee_ids : []),
    ].filter((v, i, arr) => v && arr.indexOf(v) === i);

    if (ids.length === 0 || !title || !body) {
      return new Response(
        JSON.stringify({ error: "Required: (employee_id or employee_ids), title, body" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const message: PushMessage = { title, body, data };
    const result = await sendPushToEmployees(supabase, ids, message);

    return new Response(
      JSON.stringify({
        success: true,
        notified_employee_ids: result.notifiedEmployeeIds,
        employees_without_token: result.employeesWithoutToken,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Error in send-push-notification:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
