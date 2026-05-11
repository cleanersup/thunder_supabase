/**
 * Invoked by DB trigger (service role) after walkthrough.status changes.
 * Dispatches to existing walkthrough edge functions so owner + client get the same emails as before.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Payload {
  walkthroughId: string;
  previousStatus: string;
  newStatus: string;
}

async function invokeFunction(
  name: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; text: string }> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const url = `${supabaseUrl}/functions/v1/${name}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, text };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { walkthroughId, previousStatus, newStatus } = (await req.json()) as Payload;
    if (!walkthroughId || !newStatus) {
      return new Response(JSON.stringify({ error: "walkthroughId and newStatus are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results: Record<string, { ok: boolean; status: number }> {};

    switch (newStatus) {
      case "Scheduled": {
        const r = await invokeFunction("send-walkthrough-confirmation", { walkthroughId });
        results.confirmation = { ok: r.ok, status: r.status };
        if (!r.ok) console.error("send-walkthrough-confirmation:", r.status, r.text);
        break;
      }
      case "Completed": {
        const email = await invokeFunction("send-walkthrough-completion", { walkthroughId });
        results.completion = { ok: email.ok, status: email.status };
        if (!email.ok) console.error("send-walkthrough-completion:", email.status, email.text);
        const sms = await invokeFunction("send-walkthrough-completion-sms", { walkthroughId });
        results.completionSms = { ok: sms.ok, status: sms.status };
        if (!sms.ok) console.error("send-walkthrough-completion-sms:", sms.status, sms.text);
        break;
      }
      case "Converted": {
        const r = await invokeFunction("send-walkthrough-converted", { walkthroughId });
        results.converted = { ok: r.ok, status: r.status };
        if (!r.ok) console.error("send-walkthrough-converted:", r.status, r.text);
        break;
      }
      case "Cancelled": {
        const email = await invokeFunction("send-walkthrough-cancellation", { walkthroughId });
        results.cancellation = { ok: email.ok, status: email.status };
        if (!email.ok) console.error("send-walkthrough-cancellation:", email.status, email.text);
        const sms = await invokeFunction("send-walkthrough-cancellation-sms", { walkthroughId });
        results.cancellationSms = { ok: sms.ok, status: sms.status };
        if (!sms.ok) console.error("send-walkthrough-cancellation-sms:", sms.status, sms.text);
        break;
      }
      default:
        return new Response(
          JSON.stringify({
            success: true,
            skipped: true,
            newStatus,
            previousStatus,
            message: "No notification configured for this status",
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
    }

    return new Response(
      JSON.stringify({
        success: true,
        walkthroughId,
        previousStatus,
        newStatus,
        results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("send-walkthrough-status-emails:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
