// Public: resolve wallet token → merchant display name + client + masked card (if any).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = (await req.json()) as { token?: string };
    const token = typeof body.token === "string" ? body.token.trim() : "";
    if (!token || token.length < 32) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: row, error: tokErr } = await supabase
      .from("client_wallet_tokens")
      .select("client_id, expires_at")
      .eq("token", token)
      .maybeSingle();

    if (tokErr || !row?.client_id) {
      return new Response(JSON.stringify({ error: "Link invalid or expired" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (new Date(row.expires_at as string) < new Date()) {
      return new Response(JSON.stringify({ error: "Link expired" }), {
        status: 410,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: client, error: clientErr } = await supabase
      .from("clients")
      .select(
        "user_id, full_name, company, email, card_brand, card_last4, card_exp_month, card_exp_year, stripe_default_payment_method_id",
      )
      .eq("id", row.client_id)
      .maybeSingle();

    if (clientErr || !client) {
      return new Response(JSON.stringify({ error: "Client not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("company_name, company_logo, stripe_account_id, stripe_onboarding_completed")
      .eq("user_id", client.user_id)
      .maybeSingle();

    const stripeReady = !!(
      profile?.stripe_account_id && profile?.stripe_onboarding_completed
    );

    const cards: Array<{
      brand: string | null;
      last4: string | null;
      expMonth: number | null;
      expYear: number | null;
    }> = [];

    if (client.stripe_default_payment_method_id) {
      cards.push({
        brand: client.card_brand ?? null,
        last4: client.card_last4 ?? null,
        expMonth: client.card_exp_month ?? null,
        expYear: client.card_exp_year ?? null,
      });
    }

    return new Response(
      JSON.stringify({
        companyName: profile?.company_name ?? null,
        companyLogo: profile?.company_logo ?? null,
        client: {
          fullName: client.full_name,
          company: client.company,
          email: client.email,
        },
        cards,
        stripeReady,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Internal error";
    console.error("client-wallet-get:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
