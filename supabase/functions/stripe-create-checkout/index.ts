// Supabase Edge Function: stripe-create-checkout
// Purpose: Create Stripe Checkout Session on connected account with application fees
// Output: Shareable payment link for B2B2C flow

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";
import Stripe from "https://esm.sh/stripe@14.14.0?target=deno";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface LineItem {
  name: string;
  description?: string;
  amount: number; // in cents
  quantity: number;
}

interface CreateCheckoutRequest {
  lineItems: LineItem[];
  customerId?: string; // Optional: pre-created customer on connected account
  customerEmail?: string; // Optional: if no customerId provided
  metadata?: Record<string, string>;
  applicationFeeAmount?: number; // Platform fee in cents (default: 0)
  connectedAccountId?: string; // Optional: for public invoice payments
  /** When true, attaches PM to Customer for off-session reuse (default false = unchanged behavior). */
  savePaymentMethod?: boolean;
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

    // Parse request body first to check for connectedAccountId
    const body: CreateCheckoutRequest = await req.json();

    let stripeAccountId: string;
    let userId: string | null = null;

    // Check if this is a public invoice payment (no auth required)
    if (body.connectedAccountId) {
      // Public flow: use provided connectedAccountId
      stripeAccountId = body.connectedAccountId;
      console.log("Public payment flow - using connected account:", stripeAccountId);
    } else {
      // Authenticated flow: get account from user profile
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

      userId = user.id;

      // Get user profile with Stripe account ID
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("stripe_account_id, stripe_charges_enabled")
        .eq("user_id", user.id)
        .single();

      if (profileError || !profile) {
        throw new Error("Profile not found");
      }

      if (!profile.stripe_account_id) {
        throw new Error("Stripe account not connected. Please complete onboarding first.");
      }

      stripeAccountId = profile.stripe_account_id;
      console.log("Authenticated payment flow - using user account:", stripeAccountId);
    }

    if (!body.lineItems || body.lineItems.length === 0) {
      throw new Error("At least one line item is required");
    }

    // Calculate total amount
    const totalAmount = body.lineItems.reduce(
      (sum, item) => sum + item.amount * item.quantity,
      0
    );

    // Application fee (platform commission) - default to 0 for now
    const applicationFeeAmount = body.applicationFeeAmount || 0;

    // Validate application fee doesn't exceed total
    if (applicationFeeAmount > totalAmount) {
      throw new Error("Application fee cannot exceed total amount");
    }

    // Get success/cancel URLs
    const appUrl = Deno.env.get("APP_URL") || "https://app.staging.thunderpro.co";

    // Transform line items to Stripe format
    const stripeLineItems: Stripe.Checkout.SessionCreateParams.LineItem[] =
      body.lineItems.map((item) => ({
        price_data: {
          currency: "usd",
          product_data: {
            name: item.name,
            description: item.description,
          },
          unit_amount: item.amount,
        },
        quantity: item.quantity,
      }));

    const savePaymentMethod = body.savePaymentMethod === true;

    // Create checkout session on connected account
    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      mode: "payment",
      line_items: stripeLineItems,
      success_url: `${appUrl}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/payment-cancelled`,
      metadata: {
        ...(userId && { merchant_user_id: userId }),
        ...body.metadata,
        ...(savePaymentMethod ? { save_payment_method: "true" } : {}),
      },
      payment_intent_data: {
        // This is where application fees are set
        application_fee_amount: applicationFeeAmount,
        metadata: {
          ...(userId && { merchant_user_id: userId }),
          ...body.metadata,
          ...(savePaymentMethod ? { save_payment_method: "true" } : {}),
        },
        ...(savePaymentMethod ? { setup_future_usage: "off_session" } : {}),
      },
    };

    // Customer / email: when savePaymentMethod, require Customer for setup_future_usage
    if (savePaymentMethod) {
      if (body.customerId) {
        sessionParams.customer = body.customerId;
      } else {
        if (!body.customerEmail) {
          throw new Error(
            "customerEmail or customerId is required when savePaymentMethod is true",
          );
        }
        sessionParams.customer_email = body.customerEmail;
        sessionParams.customer_creation = "always";
      }
    } else if (body.customerId) {
      sessionParams.customer = body.customerId;
    } else if (body.customerEmail) {
      sessionParams.customer_email = body.customerEmail;
    }

    // Create the session on the connected account
    const session = await stripe.checkout.sessions.create(sessionParams, {
      stripeAccount: stripeAccountId,
    });

    console.log("Created checkout session:", {
      sessionId: session.id,
      connectedAccountId: stripeAccountId,
      totalAmount,
      applicationFeeAmount,
      url: session.url,
    });

    return new Response(
      JSON.stringify({
        url: session.url,
        sessionId: session.id,
        connectedAccountId: stripeAccountId,
        totalAmount,
        applicationFeeAmount,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    console.error("Error in stripe-create-checkout:", error);
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
