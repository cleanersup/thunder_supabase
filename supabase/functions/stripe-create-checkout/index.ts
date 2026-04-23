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
  /** Required for public (unauthenticated) payments */
  recaptchaToken?: string;
}

/**
 * Verify a reCAPTCHA v3 token with Google.
 * Returns success=true only if the token is valid and score >= 0.5.
 * If RECAPTCHA_SECRET_KEY is not configured, allows the request through
 * with a warning so a missing env var doesn't silently break payments.
 */
async function verifyRecaptchaToken(
  token: string
): Promise<{ success: boolean; score: number }> {
  const secretKey = Deno.env.get("RECAPTCHA_SECRET_KEY");
  if (!secretKey) {
    console.warn("RECAPTCHA_SECRET_KEY not configured — skipping reCAPTCHA check");
    return { success: true, score: 1 };
  }

  const res = await fetch("https://www.google.com/recaptcha/api/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `secret=${secretKey}&response=${token}`,
  });
  const data = await res.json();
  const MIN_SCORE = 0.5;
  console.log("reCAPTCHA result:", { success: data.success, score: data.score, action: data.action });
  return {
    success: Boolean(data.success) && (data.score ?? 0) >= MIN_SCORE,
    score: data.score ?? 0,
  };
}

/** Write a row to payment_fraud_attempts — non-fatal if it fails */
async function logFraudAttempt(
  supabase: ReturnType<typeof createClient>,
  params: {
    invoiceId: string | null;
    merchantUserId: string | null;
    reason: string;
    req: Request;
    metadata?: Record<string, unknown>;
  }
) {
  const ip =
    params.req.headers.get("cf-connecting-ip") ??
    params.req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    null;
  const userAgent = params.req.headers.get("user-agent") ?? null;

  const { error } = await supabase.from("payment_fraud_attempts").insert({
    invoice_id:       params.invoiceId,
    merchant_user_id: params.merchantUserId,
    reason:           params.reason,
    ip_address:       ip,
    user_agent:       userAgent,
    metadata:         params.metadata ?? {},
  });

  if (error) {
    console.error("Warning: could not log fraud attempt:", error.message);
  } else {
    console.log("Fraud attempt logged:", params.reason, "invoice:", params.invoiceId);
  }
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    console.log("[stripe-create-checkout] OPTIONS (preflight)");
    return new Response(null, { headers: corsHeaders });
  }

  console.log("[stripe-create-checkout] ← POST at", new Date().toISOString());

  try {
    // Initialize Stripe with secret key
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeSecretKey) {
      throw new Error("STRIPE_SECRET_KEY not configured");
    }
    // Stable Acacia+ (not .preview) — https://docs.stripe.com/api/versioning
    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: "2024-11-20.acacia",
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
      // Public flow: verify reCAPTCHA before doing anything else
      if (!body.recaptchaToken) {
        console.warn("Public payment attempt without reCAPTCHA token");
        await logFraudAttempt(supabase, {
          invoiceId:        body.metadata?.invoice_id ?? null,
          merchantUserId:   body.metadata?.merchant_user_id ?? null,
          reason:           "recaptcha_missing",
          req,
          metadata:         { customer_email: body.customerEmail },
        });
        return new Response(
          JSON.stringify({ error: "Payment verification failed. Please try again." }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 403 }
        );
      }

      const recaptcha = await verifyRecaptchaToken(body.recaptchaToken);
      if (!recaptcha.success) {
        console.warn("reCAPTCHA verification failed — possible bot:", recaptcha.score);
        await logFraudAttempt(supabase, {
          invoiceId:        body.metadata?.invoice_id ?? null,
          merchantUserId:   body.metadata?.merchant_user_id ?? null,
          reason:           "recaptcha_failed",
          req,
          metadata:         { customer_email: body.customerEmail, recaptcha_score: recaptcha.score },
        });
        return new Response(
          JSON.stringify({ error: "Payment verification failed. Please try again." }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 403 }
        );
      }

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

    // ── Anti-fraud: idempotency + duplicate-payment guard ─────────────────────
    // Only applies when an invoice_id is present in the request metadata
    const invoiceId = body.metadata?.invoice_id;
    if (invoiceId) {
      const { data: invoice, error: invoiceFetchError } = await supabase
        .from("invoices")
        .select("id, status, stripe_session_id")
        .eq("id", invoiceId)
        .single();

      if (invoiceFetchError || !invoice) {
        return new Response(
          JSON.stringify({ error: "Invoice not found" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 404 }
        );
      }

      // 1. Reject if invoice is already paid
      if (invoice.status === "Paid") {
        console.log("Blocked duplicate payment attempt for already-paid invoice:", invoiceId);
        await logFraudAttempt(supabase, {
          invoiceId,
          merchantUserId: body.metadata?.merchant_user_id ?? null,
          reason: "already_paid",
          req,
          metadata: { customer_email: body.customerEmail },
        });
        return new Response(
          JSON.stringify({ error: "This invoice has already been paid." }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 409 }
        );
      }

      // 2. If an active Stripe session already exists, return it instead of creating a new one
      if (invoice.stripe_session_id) {
        try {
          const existingSession = await stripe.checkout.sessions.retrieve(
            invoice.stripe_session_id,
            { stripeAccount: stripeAccountId }
          );
          if (existingSession.status === "open") {
            console.log("Returning existing active checkout session:", existingSession.id);
            await logFraudAttempt(supabase, {
              invoiceId,
              merchantUserId: body.metadata?.merchant_user_id ?? null,
              reason: "duplicate_session",
              req,
              metadata: {
                customer_email:      body.customerEmail,
                existing_session_id: existingSession.id,
              },
            });
            return new Response(
              JSON.stringify({
                url: existingSession.url,
                sessionId: existingSession.id,
                connectedAccountId: stripeAccountId,
                existingSession: true,
              }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
            );
          }
          // Session expired or completed — continue to create a new one
          console.log("Existing session is no longer open, creating new one:", existingSession.status);
        } catch (sessionErr) {
          // Session not retrievable — continue to create a new one
          console.log("Could not retrieve existing session, creating new one:", sessionErr.message);
        }
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

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
    /** Public invoice pay (email/SMS link → /invoice/payment/:id → Checkout). */
    const isInvoiceCheckout = Boolean(body.metadata?.invoice_id);

    console.log("[stripe-create-checkout] request summary", {
      flow: body.connectedAccountId ? "public_invoice" : "authenticated",
      connectedAccountId: stripeAccountId,
      isInvoiceCheckout,
      invoice_id: body.metadata?.invoice_id ?? null,
      line_items: body.lineItems?.length ?? 0,
      total_cents: totalAmount,
      checkout_save_card_ui: isInvoiceCheckout ? "Stripe saved_payment_method_options" : "none_or_legacy",
    });

    // Create checkout session on connected account
    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      mode: "payment",
      line_items: stripeLineItems,
      success_url: `${appUrl}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/payment-cancelled`,
      metadata: {
        ...(userId && { merchant_user_id: userId }),
        ...body.metadata,
        ...(!isInvoiceCheckout && savePaymentMethod ? { save_payment_method: "true" } : {}),
      },
      payment_intent_data: {
        // This is where application fees are set
        application_fee_amount: applicationFeeAmount,
        metadata: {
          ...(userId && { merchant_user_id: userId }),
          ...body.metadata,
          ...(!isInvoiceCheckout && savePaymentMethod ? { save_payment_method: "true" } : {}),
        },
        ...(!isInvoiceCheckout && savePaymentMethod
          ? { setup_future_usage: "off_session" }
          : {}),
      },
    };

    // Invoice payments: Stripe-hosted "save payment method" checkbox (consent on Checkout).
    // See https://docs.stripe.com/payments/checkout/save-during-payment
    if (isInvoiceCheckout) {
      sessionParams.saved_payment_method_options = {
        payment_method_save: "enabled",
      };
    }

    // Customer / email: invoice Checkout requires a Customer object for payment_method_save.
    if (isInvoiceCheckout) {
      if (body.customerId) {
        sessionParams.customer = body.customerId;
      } else {
        if (!body.customerEmail) {
          throw new Error(
            "customerEmail or customerId is required for invoice payment checkout",
          );
        }
        sessionParams.customer_email = body.customerEmail;
        sessionParams.customer_creation = "always";
      }
    } else if (savePaymentMethod) {
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

    console.log("[stripe-create-checkout] session created → redirect client to Stripe", {
      sessionId: session.id,
      connectedAccountId: stripeAccountId,
      totalAmount,
      applicationFeeAmount,
    });

    // Persist the new session_id on the invoice immediately so any subsequent
    // request (refresh, second browser tab, mobile app) returns this same session
    // instead of creating a new one — webhook will overwrite this with "Paid" when done.
    if (invoiceId) {
      const { error: updateError } = await supabase
        .from("invoices")
        .update({ stripe_session_id: session.id })
        .eq("id", invoiceId);

      if (updateError) {
        console.error("Warning: could not save stripe_session_id to invoice:", updateError);
        // Non-fatal — payment can still proceed; guard will just be weaker this attempt
      } else {
        console.log("Saved stripe_session_id to invoice:", invoiceId);
      }
    }

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
