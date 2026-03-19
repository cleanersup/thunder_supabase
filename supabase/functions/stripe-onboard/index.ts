// Supabase Edge Function: stripe-onboard
// Purpose: Handle Stripe Connect onboarding for merchants
// Flow: Create or link Stripe Connect account, generate AccountLink

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";
import Stripe from "https://esm.sh/stripe@14.14.0?target=deno";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Read request body early — allows web clients to pass a custom returnUrl
    // so Stripe redirects back to the correct frontend domain (web vs mobile)
    let requestBody: { returnUrl?: string } = {};
    try {
      const text = await req.text();
      if (text) requestBody = JSON.parse(text);
    } catch { /* no body — mobile flow */ }

    // Initialize Stripe with secret key
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeSecretKey) {
      throw new Error("STRIPE_SECRET_KEY not configured");
    }
    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: "2023-10-16",
      httpClient: Stripe.createFetchHttpClient(),
    });

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify authentication
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("Missing authorization header");
    }

    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);

    if (authError || !user) {
      throw new Error("Unauthorized");
    }

    // Get user profile
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("*")
      .eq("user_id", user.id)
      .single();

    if (profileError || !profile) {
      throw new Error("Profile not found");
    }

    // Determine return URL: web clients pass their own origin so Stripe redirects
    // back to the correct domain. Mobile falls back to APP_URL env var.
    const appUrl = Deno.env.get("APP_URL") || "https://app.staging.thunderpro.co";
    const stripeReturnUrl = requestBody.returnUrl || `${appUrl}/stripe-return`;

    let accountId = profile.stripe_account_id;

    // Case 1: User doesn't have a Stripe account - create new one
    if (!accountId) {
      console.log("Creating new Stripe Connect account for user:", user.id);

      const account = await stripe.accounts.create({
        type: "express", // or "standard" - Express is simpler for most cases
        country: "US", // You can make this dynamic based on user's country
        email: user.email,
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        business_type: "company",
        business_profile: {
          name: profile.company_name || undefined,
          support_email: profile.company_email || user.email || undefined,
          support_phone: profile.company_phone || undefined,
        },
      });

      accountId = account.id;

      // Save the account ID to the database
      const { error: updateError } = await supabase
        .from("profiles")
        .update({ stripe_account_id: accountId })
        .eq("user_id", user.id);

      if (updateError) {
        console.error("Failed to save Stripe account ID:", updateError);
        throw new Error("Failed to save Stripe account");
      }

      console.log("Created Stripe account:", accountId);
    } else {
      console.log("User already has Stripe account:", accountId);

      // Case 2: User has existing account - verify it still exists
      try {
        await stripe.accounts.retrieve(accountId);
      } catch (error) {
        console.error("Stripe account not found, creating new one:", error);
        // Account doesn't exist anymore, create a new one
        const account = await stripe.accounts.create({
          type: "express",
          country: "US",
          email: user.email,
          capabilities: {
            card_payments: { requested: true },
            transfers: { requested: true },
          },
        });

        accountId = account.id;

        await supabase
          .from("profiles")
          .update({ stripe_account_id: accountId })
          .eq("user_id", user.id);
      }
    }

    // Create AccountLink for onboarding.
    // return_url/refresh_url use stripeReturnUrl so web clients land back on
    // their own domain (authenticated) instead of the swift-slate staging URL.
    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: stripeReturnUrl,
      return_url: `${stripeReturnUrl}?account_id=${accountId}`,
      type: "account_onboarding",
    });

    console.log("Generated AccountLink:", accountLink.url);

    return new Response(
      JSON.stringify({
        url: accountLink.url,
        accountId: accountId,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    console.error("Error in stripe-onboard:", error);
    return new Response(
      JSON.stringify({
        error: error.message || "Internal server error",
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      }
    );
  }
});
