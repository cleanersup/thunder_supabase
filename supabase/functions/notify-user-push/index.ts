import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendPushToUsers, type PushMessage } from "../_shared/fcm.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface NotifyRequest {
  userId?: string;
  user_ids?: string[];
  title: string;
  body: string;
  data?: Record<string, string>;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { userId, user_ids, title, body, data }: NotifyRequest = await req.json();

    const ids = [
      ...(userId ? [userId] : []),
      ...(Array.isArray(user_ids) ? user_ids : []),
    ].filter((v, i, arr) => v && arr.indexOf(v) === i);

    if (ids.length === 0 || !title || !body) {
      return new Response(
        JSON.stringify({ error: "Required: (userId or user_ids), title, body" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const message: PushMessage = { title, body, data };
    const result = await sendPushToUsers(supabase, ids, message);

    return new Response(
      JSON.stringify({
        success: true,
        notified_user_ids: result.notifiedUserIds,
        users_without_token: result.usersWithoutToken,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Error in notify-user-push:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
