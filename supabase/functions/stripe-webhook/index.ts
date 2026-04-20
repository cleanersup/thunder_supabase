// Supabase Edge Function: stripe-webhook
// Purpose: Handle Stripe Connect webhook events (checkout.session.completed, etc.)
// Security: Verifies Stripe signatures to ensure authenticity

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";
import Stripe from "https://esm.sh/stripe@14.14.0?target=deno";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, stripe-signature",
};

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Initialize Stripe
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
    const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");

    if (!stripeSecretKey || !webhookSecret) {
      throw new Error("Stripe configuration missing");
    }

    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: "2023-10-16",
      httpClient: Stripe.createFetchHttpClient(),
    });

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get the raw body for signature verification
    const body = await req.text();
    const signature = req.headers.get("stripe-signature");

    if (!signature) {
      throw new Error("Missing stripe-signature header");
    }

    // Verify webhook signature
    let event: Stripe.Event;
    try {
      event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);
      console.log("Webhook verified:", event.type);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Internal server error";
      console.error("Webhook signature verification failed:", errorMessage);
      return new Response(
        JSON.stringify({ error: errorMessage }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        }
      );
    }

    // Handle different event types
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        console.log("Checkout session completed:", session.id);

        // Extract merchant user ID from metadata
        const merchantUserId = session.metadata?.merchant_user_id;
        const connectedAccountId = event.account; // This is the connected account ID

        // Retrieve the full session with line items
        const fullSession = await stripe.checkout.sessions.retrieve(session.id, {
          expand: ["line_items", "payment_intent"],
          stripeAccount: connectedAccountId || undefined,
        });

        // Get payment intent details
        const piRaw = fullSession.payment_intent;
        const paymentIntent =
          typeof piRaw === "string" ? null : (piRaw as Stripe.PaymentIntent | null);
        const paymentIntentId =
          typeof piRaw === "string" ? piRaw : paymentIntent?.id ?? null;

        // Log the successful payment
        const paymentData = {
          session_id: session.id,
          payment_intent_id: paymentIntentId,
          connected_account_id: connectedAccountId,
          merchant_user_id: merchantUserId,
          customer_email: session.customer_details?.email,
          amount_total: session.amount_total, // in cents
          amount_subtotal: session.amount_subtotal,
          application_fee_amount: paymentIntent?.application_fee_amount || 0,
          currency: session.currency,
          payment_status: session.payment_status,
          metadata: session.metadata,
          created_at: new Date().toISOString(),
        };

        console.log("Payment completed:", paymentData);

        // Extract metadata
        const invoiceIdRaw = session.metadata?.invoice_id;
        const invoiceId =
          typeof invoiceIdRaw === "string"
            ? invoiceIdRaw.trim()
            : invoiceIdRaw != null
              ? String(invoiceIdRaw)
              : undefined;
        const merchantUserIdFromMetadata = session.metadata?.merchant_user_id;

        // Store payment data in database
        const { error: paymentError } = await supabase.from("payments").insert({
          user_id: merchantUserId || merchantUserIdFromMetadata,
          invoice_id: invoiceId,
          amount: session.amount_total! / 100, // Convert cents to major currency
          currency: session.currency || "usd",
          status: session.payment_status === "paid" ? "succeeded" : "failed",
          stripe_payment_intent_id: paymentIntentId,
          stripe_session_id: session.id,
          payment_method: session.payment_method_types?.[0],
          metadata: session.metadata,
        });

        if (paymentError) {
          console.error("Error storing payment data:", paymentError);
        } else {
          console.log("Payment record stored successfully");
        }

        // Update invoice status if invoice_id exists in metadata
        if (invoiceId) {
          const { data: invoice, error: invoiceError } = await supabase
            .from("invoices")
            .update({
              status: "Paid",
              paid_at: new Date().toISOString(),
              paid_date: new Date().toISOString().split("T")[0],
              stripe_payment_intent_id: paymentIntentId,
              stripe_session_id: session.id,
              payment_method: session.payment_method_types?.[0] || 'stripe',
            })
            .eq("id", invoiceId)
            .select("invoice_number, client_name, total, email")
            .single();

          if (invoiceError) {
            console.error("Error updating invoice:", invoiceError);
          } else {
            console.log("Invoice marked as paid:", {
              invoiceId,
              invoiceNumber: invoice.invoice_number,
              clientName: invoice.client_name,
              total: invoice.total,
            });

            try {
              const { error: paidEmailError } = await supabase.functions.invoke(
                "send-invoice-email",
                { body: { invoiceId, isPaymentConfirmation: true } },
              );
              if (paidEmailError) {
                console.error("send-invoice-email (paid):", paidEmailError);
              } else {
                console.log("Payment confirmation emails queued via send-invoice-email");
              }
            } catch (emailErr) {
              console.error("send-invoice-email invoke failed:", emailErr);
            }

            // Create notification for the merchant
            try {
              const { error: notificationError } = await supabase.from("notifications").insert({
                user_id: merchantUserId || merchantUserIdFromMetadata,
                type: 'invoice_paid',
                title: 'Invoice Paid',
                message: `Invoice ${invoice.invoice_number} for ${invoice.client_name} has been paid ($${invoice.total})`,
                related_id: invoiceId,
                related_type: 'invoice',
              });

              if (notificationError) {
                console.error("Error creating notification:", notificationError);
              } else {
                console.log("Notification created for merchant");
              }

              // Also add to activities
              const { error: activityError } = await supabase.from("activities").insert({
                user_id: merchantUserId || merchantUserIdFromMetadata,
                type: 'invoice_paid',
                title: `Invoice ${invoice.invoice_number} marked as paid`,
                invoice_number: invoice.invoice_number || '',
                client_name: invoice.client_name || '',
                amount: invoice.total || 0,
                metadata: {
                  source: 'stripe',
                  session_id: session.id
                }
              });

              if (activityError) {
                console.error("Error creating activity:", activityError);
              } else {
                console.log("Activity created for merchant");
              }
            } catch (notifyErr) {
              console.error("Error in notification/activity logic:", notifyErr);
            }
          }
        }

        break;
      }

      case "account.updated": {
        const account = event.data.object as Stripe.Account;
        console.log("Account updated:", account.id);

        // Determine if onboarding is completed
        // In test mode, charges_enabled might be false even after onboarding
        // So we check: details_submitted AND (charges_enabled OR currently_due is empty)
        const currentlyDue = account.requirements?.currently_due || [];
        const isOnboardingComplete =
          account.details_submitted &&
          (account.charges_enabled || currentlyDue.length === 0);

        console.log("Account status check:", {
          accountId: account.id,
          details_submitted: account.details_submitted,
          charges_enabled: account.charges_enabled,
          currently_due: currentlyDue,
          onboarding_completed: isOnboardingComplete,
        });

        // Update the profile with account capabilities
        const { error: updateError } = await supabase
          .from("profiles")
          .update({
            stripe_charges_enabled: account.charges_enabled || false,
            stripe_payouts_enabled: account.payouts_enabled || false,
            stripe_onboarding_completed: isOnboardingComplete,
          })
          .eq("stripe_account_id", account.id);

        if (updateError) {
          console.error("Failed to update profile:", updateError);
        } else {
          console.log("Updated profile for account:", account.id);
        }

        break;
      }

      case "payment_intent.succeeded": {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        console.log("Payment intent succeeded:", paymentIntent.id);

        // Additional handling if needed
        break;
      }

      case "payment_intent.payment_failed": {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        console.log("Payment intent failed:", paymentIntent.id);

        // Handle failed payment (notify merchant, update records, etc.)
        break;
      }

      case "charge.refunded": {
        const charge = event.data.object as Stripe.Charge;
        console.log("Charge refunded:", charge.id);

        // Update invoice status to Refunded
        const paymentIntentId = typeof charge.payment_intent === 'string'
          ? charge.payment_intent
          : charge.payment_intent?.id;

        if (paymentIntentId) {
          const { data: invoice, error: invoiceError } = await supabase
            .from("invoices")
            .update({
              status: "Refunded",
              refunded_at: new Date().toISOString(),
            })
            .eq("stripe_payment_intent_id", paymentIntentId)
            .select("invoice_number, client_name, total")
            .single();

          if (invoiceError) {
            console.error("Error updating invoice to refunded:", invoiceError);
          } else if (invoice) {
            console.log("Invoice marked as refunded:", {
              invoiceNumber: invoice.invoice_number,
              clientName: invoice.client_name,
              total: invoice.total,
            });
          } else {
            console.log("No invoice found for payment_intent:", paymentIntentId);
          }
        }

        break;
      }

      default:
        console.log("Unhandled event type:", event.type);
    }

    // Return success response
    return new Response(JSON.stringify({ received: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Internal server error";
    console.error("Error in stripe-webhook:", errorMessage);
    return new Response(
      JSON.stringify({
        error: errorMessage,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      }
    );
  }
});
