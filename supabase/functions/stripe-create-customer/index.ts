// Supabase Edge Function: stripe-create-customer
// Purpose: Create a Stripe customer on the merchant's connected account
// Critical: Uses Stripe-Account header to create customer on connected account

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";
import Stripe from "https://esm.sh/stripe@14.14.0?target=deno";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface CreateCustomerRequest {
  email: string;
  name: string;
  phone?: string;
  metadata?: Record<string, string>;
}

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

    // Get user profile with Stripe account ID
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("stripe_account_id")
      .eq("user_id", user.id)
      .single();

    if (profileError || !profile) {
      throw new Error("Profile not found");
    }

    if (!profile.stripe_account_id) {
      throw new Error("Stripe account not connected. Please complete onboarding first.");
    }

    // Parse request body
    const body: CreateCustomerRequest = await req.json();

    if (!body.email || !body.name) {
      throw new Error("Email and name are required");
    }

    // Create customer on the connected account
    // CRITICAL: This creates the customer on the merchant's Stripe account
    const customer = await stripe.customers.create(
      {
        email: body.email,
        name: body.name,
        phone: body.phone,
        metadata: {
          ...body.metadata,
          merchant_user_id: user.id,
        },
      },
      {
        stripeAccount: profile.stripe_account_id, // This is the key!
      }
    );

    console.log("Created customer on connected account:", {
      customerId: customer.id,
      connectedAccountId: profile.stripe_account_id,
    });

    return new Response(
      JSON.stringify({
        customerId: customer.id,
        connectedAccountId: profile.stripe_account_id,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    console.error("Error in stripe-create-customer:", error);
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
