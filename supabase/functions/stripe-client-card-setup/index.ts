// Supabase Edge Function: stripe-client-card-setup
// Merchant-authenticated card setup for CRM clients using Stripe Elements.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";
import Stripe from "https://esm.sh/stripe@14.14.0?target=deno";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

type SetupRequest =
  | { action: "create"; clientId: string }
  | { action: "finalize"; clientId: string; setupIntentId: string };

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeSecretKey) throw new Error("STRIPE_SECRET_KEY not configured");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "Unauthorized" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return json({ error: "Unauthorized" }, 401);
    }

    const body = (await req.json()) as SetupRequest;
    if (!body.clientId) {
      return json({ error: "clientId is required" }, 400);
    }

    const { data: client, error: clientError } = await supabase
      .from("clients")
      .select("id, user_id, email, full_name, stripe_customer_id")
      .eq("id", body.clientId)
      .maybeSingle();

    if (clientError || !client || client.user_id !== user.id) {
      return json({ error: "Client not found" }, 404);
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("stripe_account_id, stripe_onboarding_completed, stripe_charges_enabled")
      .eq("user_id", user.id)
      .maybeSingle();

    if (profileError || !profile?.stripe_account_id) {
      return json({ error: "Stripe account not connected" }, 400);
    }

    if (!profile.stripe_onboarding_completed) {
      return json({ error: "Stripe onboarding is not complete yet" }, 400);
    }

    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: "2024-11-20.acacia",
      httpClient: Stripe.createFetchHttpClient(),
    });
    const connectedAccountId = profile.stripe_account_id as string;

    let customerId = client.stripe_customer_id as string | null;
    if (!customerId) {
      const customer = await stripe.customers.create(
        {
          email: client.email,
          name: client.full_name,
          metadata: { thunder_client_id: client.id, merchant_user_id: user.id },
        },
        { stripeAccount: connectedAccountId },
      );
      customerId = customer.id;

      const { error: customerUpdateError } = await supabase
        .from("clients")
        .update({ stripe_customer_id: customerId, updated_at: new Date().toISOString() })
        .eq("id", client.id);

      if (customerUpdateError) {
        console.error("stripe-client-card-setup customer update:", customerUpdateError);
        return json({ error: "Could not prepare client payment profile" }, 500);
      }
    }

    if (body.action === "create") {
      const setupIntent = await stripe.setupIntents.create(
        {
          customer: customerId,
          payment_method_types: ["card"],
          usage: "off_session",
          metadata: {
            client_id: client.id,
            merchant_user_id: user.id,
            source: "merchant_dashboard",
          },
        },
        { stripeAccount: connectedAccountId },
      );

      return json({
        clientSecret: setupIntent.client_secret,
        setupIntentId: setupIntent.id,
        connectedAccountId,
      });
    }

    if (body.action !== "finalize") {
      return json({ error: "Invalid action" }, 400);
    }

    if (!body.setupIntentId) {
      return json({ error: "setupIntentId is required" }, 400);
    }

    const setupIntent = await stripe.setupIntents.retrieve(
      body.setupIntentId,
      { expand: ["payment_method"] },
      { stripeAccount: connectedAccountId },
    );

    if (setupIntent.metadata?.client_id !== client.id || setupIntent.metadata?.merchant_user_id !== user.id) {
      return json({ error: "Setup intent does not match this client" }, 403);
    }

    if (setupIntent.status !== "succeeded") {
      return json({ error: `Card setup is not complete (${setupIntent.status})` }, 400);
    }

    const paymentMethod =
      typeof setupIntent.payment_method === "string"
        ? await stripe.paymentMethods.retrieve(setupIntent.payment_method, {
            stripeAccount: connectedAccountId,
          })
        : setupIntent.payment_method;

    if (!paymentMethod || paymentMethod.type !== "card" || !paymentMethod.card) {
      return json({ error: "Saved payment method is not a card" }, 400);
    }

    await stripe.customers.update(
      customerId,
      { invoice_settings: { default_payment_method: paymentMethod.id } },
      { stripeAccount: connectedAccountId },
    );

    const { data: updatedClient, error: updateError } = await supabase
      .from("clients")
      .update({
        stripe_customer_id: customerId,
        stripe_default_payment_method_id: paymentMethod.id,
        card_brand: paymentMethod.card.brand ?? null,
        card_last4: paymentMethod.card.last4 ?? null,
        card_exp_month: paymentMethod.card.exp_month ?? null,
        card_exp_year: paymentMethod.card.exp_year ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", client.id)
      .select("*")
      .single();

    if (updateError) {
      console.error("stripe-client-card-setup client update:", updateError);
      return json({ error: "Card saved in Stripe but dashboard update failed" }, 500);
    }

    return json({
      client: updatedClient,
      paymentMethod: {
        id: paymentMethod.id,
        brand: paymentMethod.card.brand,
        last4: paymentMethod.card.last4,
        expMonth: paymentMethod.card.exp_month,
        expYear: paymentMethod.card.exp_year,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    console.error("stripe-client-card-setup:", message);
    return json({ error: message }, 400);
  }
});
