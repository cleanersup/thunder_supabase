// Public: create Stripe Checkout Session (mode=setup) on merchant connected account for wallet token.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";
import Stripe from "https://esm.sh/stripe@14.14.0?target=deno";

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
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeSecretKey) {
      throw new Error("STRIPE_SECRET_KEY not configured");
    }
    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: "2023-10-16",
      httpClient: Stripe.createFetchHttpClient(),
    });

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
        "id, user_id, email, full_name, stripe_customer_id",
      )
      .eq("id", row.client_id)
      .maybeSingle();

    if (clientErr || !client) {
      return new Response(JSON.stringify({ error: "Client not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: profile, error: profErr } = await supabase
      .from("profiles")
      .select("stripe_account_id, stripe_charges_enabled, stripe_onboarding_completed")
      .eq("user_id", client.user_id)
      .maybeSingle();

    if (profErr || !profile?.stripe_account_id) {
      return new Response(JSON.stringify({ error: "Merchant payments not configured" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const connectedAccountId = profile.stripe_account_id as string;
    if (!profile.stripe_onboarding_completed) {
      return new Response(
        JSON.stringify({ error: "Merchant Stripe onboarding is not complete yet" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    let customerId = client.stripe_customer_id as string | null;

    if (!customerId) {
      const customer = await stripe.customers.create(
        {
          email: client.email,
          name: client.full_name,
          metadata: { thunder_client_id: client.id },
        },
        { stripeAccount: connectedAccountId },
      );
      customerId = customer.id;
      await supabase
        .from("clients")
        .update({ stripe_customer_id: customerId, updated_at: new Date().toISOString() })
        .eq("id", client.id);
    }

    const appUrl = (Deno.env.get("APP_URL") ?? "https://app.staging.thunderpro.co").replace(/\/$/, "");
    const successUrl = `${appUrl}/client/wallet/${encodeURIComponent(token)}?setup=complete`;
    const cancelUrl = `${appUrl}/client/wallet/${encodeURIComponent(token)}?setup=cancel`;

    const session = await stripe.checkout.sessions.create(
      {
        mode: "setup",
        customer: customerId,
        payment_method_types: ["card"],
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: {
          client_wallet_setup: "true",
          client_id: client.id,
          merchant_user_id: client.user_id,
        },
      },
      { stripeAccount: connectedAccountId },
    );

    if (!session.url) {
      throw new Error("No Checkout URL returned");
    }

    return new Response(JSON.stringify({ url: session.url, sessionId: session.id }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Internal error";
    console.error("client-wallet-setup-checkout:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
