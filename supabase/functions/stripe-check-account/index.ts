// Supabase Edge Function: stripe-check-account
// Purpose: Check Stripe Connect account status and update database
// Called when user returns from onboarding to verify account status

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
      .select("stripe_account_id")
      .eq("user_id", user.id)
      .single();

    if (profileError || !profile || !profile.stripe_account_id) {
      throw new Error("No Stripe account found for this user");
    }

    const accountId = profile.stripe_account_id;

    // Retrieve account status from Stripe
    console.log("Checking Stripe account status:", accountId);
    const account = await stripe.accounts.retrieve(accountId);

    // Determine if onboarding is completed
    // In test mode, charges_enabled might be false even after onboarding
    // So we check: details_submitted AND (charges_enabled OR currently_due is empty)
    const currentlyDue = account.requirements?.currently_due || [];
    const isOnboardingComplete =
      account.details_submitted &&
      (account.charges_enabled || currentlyDue.length === 0);

    // Update profile with current status
    const { error: updateError } = await supabase
      .from("profiles")
      .update({
        stripe_charges_enabled: account.charges_enabled || false,
        stripe_payouts_enabled: account.payouts_enabled || false,
        stripe_onboarding_completed: isOnboardingComplete,
      })
      .eq("user_id", user.id);

    if (updateError) {
      console.error("Failed to update profile:", updateError);
      throw new Error("Failed to update profile");
    }

    console.log("Updated profile with account status:", {
      accountId,
      charges_enabled: account.charges_enabled,
      payouts_enabled: account.payouts_enabled,
      details_submitted: account.details_submitted,
      currently_due: currentlyDue,
      onboarding_completed: isOnboardingComplete,
    });

    return new Response(
      JSON.stringify({
        accountId: accountId,
        chargesEnabled: account.charges_enabled || false,
        payoutsEnabled: account.payouts_enabled || false,
        detailsSubmitted: account.details_submitted || false,
        currentlyDue: currentlyDue,
        onboardingCompleted: isOnboardingComplete,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    console.error("Error in stripe-check-account:", error);
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
