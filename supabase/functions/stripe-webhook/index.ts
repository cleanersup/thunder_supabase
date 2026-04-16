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
    console.log("[stripe-webhook] OPTIONS (preflight)");
    return new Response(null, { headers: corsHeaders });
  }

  // Uptime / routing check (Stripe only POSTs; this proves Kong reaches the function).
  if (req.method === "GET") {
    console.log("[stripe-webhook] GET health check");
    return new Response(JSON.stringify({ ok: true, fn: "stripe-webhook" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  console.log("[stripe-webhook] ←", req.method, "at", new Date().toISOString());

  try {
    // Initialize Stripe
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
    const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");

    if (!stripeSecretKey || !webhookSecret) {
      throw new Error("Stripe configuration missing");
    }
    console.log("[stripe-webhook] env ok (STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET present)");

    // Pin a stable Acacia-era version so PaymentMethod.allow_redisplay is populated (Checkout save-card vault).
    // Prefer stable dated versions over .preview in production — see https://docs.stripe.com/api/versioning
    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: "2024-11-20.acacia",
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
      console.log(
        "[stripe-webhook] signature OK →",
        `type=${event.type}`,
        `event_id=${event.id}`,
        `livemode=${event.livemode}`,
        `account=${(event as Stripe.Event & { account?: string }).account ?? "(none)"}`,
      );
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Internal server error";
      console.error("[stripe-webhook] signature FAILED:", errorMessage);
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
        const connectedAccountId = event.account; // Connect: acct_…; required for direct charges on connected account

        console.log("[stripe-webhook] checkout.session.completed", {
          session_id: session.id,
          mode: session.mode,
          payment_status: session.payment_status,
          account: connectedAccountId ?? null,
          metadata_keys: session.metadata ? Object.keys(session.metadata) : [],
          invoice_id: session.metadata?.invoice_id ?? null,
        });

        if (!connectedAccountId && session.mode === "payment") {
          console.warn(
            "[Vault] checkout.session.completed missing event.account (Connect). " +
              "Register this webhook in Stripe Connect → Webhooks to receive connected-account events, " +
              "or events will not resolve payment methods on the right account.",
          );
        }

        // ── Client wallet: Setup Checkout (add/update card on CRM client) ─────
        if (
          session.mode === "setup" &&
          session.metadata?.client_wallet_setup === "true" &&
          connectedAccountId
        ) {
          try {
            const clientId = session.metadata?.client_id;
            if (!clientId) {
              console.warn("Wallet setup: missing client_id in metadata");
              break;
            }

            const fullSetupSession = await stripe.checkout.sessions.retrieve(session.id, {
              expand: ["setup_intent", "setup_intent.payment_method"],
            }, { stripeAccount: connectedAccountId });

            const siRaw = fullSetupSession.setup_intent;
            const setupIntentId =
              typeof siRaw === "string" ? siRaw : (siRaw as Stripe.SetupIntent | null)?.id;
            if (!setupIntentId) {
              console.warn("Wallet setup: no setup_intent on session");
              break;
            }

            const si = await stripe.setupIntents.retrieve(setupIntentId, {
              expand: ["payment_method"],
            }, { stripeAccount: connectedAccountId });

            const pmField = si.payment_method;
            let pmId: string | null =
              typeof pmField === "string" ? pmField : (pmField as Stripe.PaymentMethod | null)?.id ?? null;
            const custField = si.customer;
            const customerId: string | null =
              typeof custField === "string"
                ? custField
                : (custField as Stripe.Customer | null)?.id ?? null;

            let pmObj: Stripe.PaymentMethod | null =
              pmField && typeof pmField !== "string" ? (pmField as Stripe.PaymentMethod) : null;
            if (pmId && !pmObj) {
              pmObj = await stripe.paymentMethods.retrieve(pmId, {
                stripeAccount: connectedAccountId,
              });
            }

            if (customerId && pmId && pmObj?.type === "card" && pmObj.card) {
              await stripe.customers.update(
                customerId,
                { invoice_settings: { default_payment_method: pmId } },
                { stripeAccount: connectedAccountId },
              );

              const { error: walletUpdErr } = await supabase
                .from("clients")
                .update({
                  stripe_customer_id: customerId,
                  stripe_default_payment_method_id: pmId,
                  card_brand: pmObj.card.brand ?? null,
                  card_last4: pmObj.card.last4 ?? null,
                  card_exp_month: pmObj.card.exp_month ?? null,
                  card_exp_year: pmObj.card.exp_year ?? null,
                  updated_at: new Date().toISOString(),
                })
                .eq("id", clientId);

              if (walletUpdErr) {
                console.error("Wallet setup: client update error", walletUpdErr);
              } else {
                console.log("Wallet setup: saved payment method for client", clientId);
              }
            } else {
              console.warn("Wallet setup: missing customer/pm or not a card", {
                customerId,
                pmId,
                type: pmObj?.type,
              });
            }
          } catch (walletErr) {
            console.error("Wallet setup handler error:", walletErr);
          }
          break;
        }

        if (session.mode !== "payment") {
          console.log("[stripe-webhook] skip: session.mode is not payment:", session.mode);
          break;
        }

        // Extract merchant user ID from metadata
        const merchantUserId = session.metadata?.merchant_user_id;

        console.log("[stripe-webhook] retrieving session + PI on connected account…");

        // Retrieve the full session with line items
        const fullSession = await stripe.checkout.sessions.retrieve(session.id, {
          expand: ["line_items", "payment_intent", "payment_intent.payment_method"],
          stripeAccount: connectedAccountId || undefined,
        });

        // payment_intent may be an expanded object or only a string id — never assume .id exists.
        const piRaw = fullSession.payment_intent;
        const paymentIntentId =
          typeof piRaw === "string"
            ? piRaw
            : (piRaw as Stripe.PaymentIntent | null)?.id ?? null;

        let paymentIntent: Stripe.PaymentIntent | null =
          piRaw && typeof piRaw !== "string" ? (piRaw as Stripe.PaymentIntent) : null;

        if (paymentIntentId && (!paymentIntent?.id || typeof piRaw === "string")) {
          try {
            paymentIntent = await stripe.paymentIntents.retrieve(
              paymentIntentId,
              { expand: ["payment_method"] },
              { stripeAccount: connectedAccountId || undefined },
            );
          } catch (piErr) {
            console.error("[stripe-webhook] paymentIntents.retrieve failed:", piErr);
            paymentIntent = null;
          }
        }

        console.log("[stripe-webhook] expanded session", {
          payment_intent_id: paymentIntent?.id ?? paymentIntentId,
          amount_total: fullSession.amount_total,
        });

        // Log the successful payment
        const paymentData = {
          session_id: session.id,
          payment_intent_id: paymentIntent?.id ?? paymentIntentId,
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

        console.log("[stripe-webhook] payment snapshot (before DB writes):", paymentData);

        // Extract metadata
        const invoiceId = session.metadata?.invoice_id;
        const merchantUserIdFromMetadata = session.metadata?.merchant_user_id;

        // Store payment data in database
        const { error: paymentError } = await supabase.from("payments").insert({
          user_id: merchantUserId || merchantUserIdFromMetadata,
          invoice_id: invoiceId,
          amount: session.amount_total! / 100, // Convert cents to major currency
          currency: session.currency || "usd",
          status: session.payment_status === "paid" ? "succeeded" : "failed",
          stripe_payment_intent_id: paymentIntent?.id ?? paymentIntentId ?? null,
          stripe_session_id: session.id,
          payment_method: session.payment_method_types?.[0],
          metadata: session.metadata,
        });

        if (paymentError) {
          console.error("[stripe-webhook] payments INSERT failed:", paymentError);
        } else {
          console.log("[stripe-webhook] payments INSERT ok", { invoice_id: invoiceId ?? null });
        }

        // Update invoice status if invoice_id exists in metadata
        if (invoiceId) {
          const { data: invoice, error: invoiceError } = await supabase
            .from("invoices")
            .update({
              status: "Paid",
              paid_at: new Date().toISOString(),
              stripe_payment_intent_id: paymentIntent?.id ?? paymentIntentId ?? null,
              stripe_session_id: session.id,
              payment_method: session.payment_method_types?.[0] || 'stripe',
            })
            .eq("id", invoiceId)
            .select("invoice_number, client_name, total, email")
            .single();

          if (invoiceError) {
            console.error("[stripe-webhook] invoice UPDATE failed:", invoiceError);
          } else {
            console.log("[stripe-webhook] invoice UPDATE → Paid", {
              invoiceId,
              invoiceNumber: invoice.invoice_number,
              clientName: invoice.client_name,
              total: invoice.total,
            });

            // Call send-invoice-email edge function to send payment confirmation
            try {
              await supabase.functions.invoke("send-invoice-email", {
                body: { invoiceId, isPaymentConfirmation: true },
              });
              console.log("Payment confirmation email triggered");
            } catch (emailError) {
              console.error("Error triggering payment confirmation email:", emailError);
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

        // Persist saved card on CRM client (never block paid flow).
        // Invoice flow: user opts in on Stripe Checkout → PM allow_redisplay === "always".
        // Legacy: session.metadata.save_payment_method === "true" (setup_future_usage path).
        try {
          const emailLooksValid = (e: string) =>
            e.length > 0 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

          if (invoiceId && connectedAccountId && paymentIntent?.id) {
            const customerId =
              typeof fullSession.customer === "string"
                ? fullSession.customer
                : (fullSession.customer as Stripe.Customer | null)?.id ?? null;

            const pmField = paymentIntent.payment_method;
            let pmId: string | null =
              typeof pmField === "string" ? pmField : (pmField as Stripe.PaymentMethod | null)?.id ?? null;

            let pmObj: Stripe.PaymentMethod | null =
              pmField && typeof pmField !== "string" ? (pmField as Stripe.PaymentMethod) : null;
            if (pmId && !pmObj) {
              pmObj = await stripe.paymentMethods.retrieve(pmId, {
                stripeAccount: connectedAccountId,
              });
            }

            const allowRedisplay = pmObj?.allow_redisplay ?? null;
            /** Stripe Checkout “Save card” maps to allow_redisplay === "always" on the PM (Acacia+). */
            const saveCardCheckedCheckout = allowRedisplay === "always";
            const legacySaveFlag = session.metadata?.save_payment_method === "true";
            const shouldVault = saveCardCheckedCheckout || legacySaveFlag;

            const sessionPayerEmail = session.customer_details?.email?.trim() ?? null;

            console.log("[Vault] invoice payment method snapshot", {
              invoice_id: invoiceId,
              connected_account_id: connectedAccountId ?? null,
              stripe_customer_on_session: customerId,
              payment_intent_id: paymentIntent.id,
              payment_method_id: pmId,
              payment_method_type: pmObj?.type ?? null,
              /** true = payer checked save on Stripe-hosted Checkout */
              save_card_checked_on_checkout: saveCardCheckedCheckout,
              payment_method_allow_redisplay: allowRedisplay,
              save_card_metadata_legacy: legacySaveFlag,
              will_attempt_vault_if_crm_match: shouldVault,
              session_payer_email: sessionPayerEmail,
              session_payer_email_present: Boolean(sessionPayerEmail),
              session_payer_email_looks_valid: sessionPayerEmail ? emailLooksValid(sessionPayerEmail) : false,
            });

            if (!customerId || !pmId || !pmObj?.card) {
              console.warn("[Vault] skip: missing customer, payment method, or card details", {
                has_stripe_customer_id: Boolean(customerId),
                has_payment_method_id: Boolean(pmId),
                has_card_on_pm: Boolean(pmObj?.card),
              });
            } else if (pmObj.type !== "card") {
              console.warn("[Vault] skip: only card payment methods are vaulted (got type:", pmObj.type, ")");
            } else if (!shouldVault) {
              console.warn(
                "[Vault] skip: save card not opted in — save_card_checked_on_checkout=false and metadata save_payment_method≠true",
                {
                  save_card_checked_on_checkout: saveCardCheckedCheckout,
                  allow_redisplay: allowRedisplay,
                  legacy_metadata_save_payment_method: legacySaveFlag,
                  hint: "If save was checked in Checkout but allow_redisplay is null, confirm API version is Acacia+ on this function.",
                },
              );
            } else if (customerId && pmId && pmObj?.type === "card" && pmObj.card && shouldVault) {
              const { data: invRow, error: invFetchErr } = await supabase
                .from("invoices")
                .select("user_id, email")
                .eq("id", invoiceId)
                .single();

              if (invFetchErr || !invRow?.user_id || !invRow.email) {
                console.warn("[Vault] skip: could not load invoice for CRM email match", {
                  inv_fetch_error: invFetchErr,
                  has_user_id: Boolean(invRow?.user_id),
                  has_invoice_email: Boolean(invRow?.email),
                });
              } else {
                const emailTrim = (invRow.email as string).trim();
                const checkoutEmail = sessionPayerEmail;
                const emailsMatchIgnoreCase = checkoutEmail
                  ? checkoutEmail.toLowerCase() === emailTrim.toLowerCase()
                  : null;

                console.log("[Vault] invoice vs payer email (CRM vault uses invoice email only)", {
                  invoice_id: invoiceId,
                  merchant_user_id: invRow.user_id,
                  invoice_email_trimmed: emailTrim,
                  invoice_email_length: emailTrim.length,
                  invoice_email_looks_valid: emailLooksValid(emailTrim),
                  checkout_session_payer_email: checkoutEmail,
                  checkout_vs_invoice_email_same_ignore_case: emailsMatchIgnoreCase,
                  note: "Vault RPC matches CRM clients.email to invoice email; mismatch with Checkout payer email can still vault if invoice email matches a client row.",
                });

                const { data: vaultClientId, error: rpcErr } = await supabase.rpc(
                  "get_client_id_for_invoice_vault",
                  { p_user_id: invRow.user_id, p_email: emailTrim },
                );

                if (rpcErr) {
                  console.error("[Vault] RPC get_client_id_for_invoice_vault error:", rpcErr);
                } else if (!vaultClientId) {
                  console.warn(
                    "[Vault] skip: no CRM client row with same email as invoice (case-insensitive lookup)",
                    {
                      invoice_email_used_for_lookup: emailTrim,
                      invoice_email_looks_valid: emailLooksValid(emailTrim),
                    },
                  );
                } else {
                  console.log("[Vault] CRM client matched for vault update", {
                    vault_client_id: vaultClientId,
                    invoice_email: emailTrim,
                  });

                  const { error: clientUpdErr } = await supabase
                    .from("clients")
                    .update({
                      stripe_customer_id: customerId,
                      stripe_default_payment_method_id: pmId,
                      card_brand: pmObj.card.brand ?? null,
                      card_last4: pmObj.card.last4 ?? null,
                      card_exp_month: pmObj.card.exp_month ?? null,
                      card_exp_year: pmObj.card.exp_year ?? null,
                      updated_at: new Date().toISOString(),
                    })
                    .eq("id", vaultClientId);

                  if (clientUpdErr) {
                    console.error("Vault: client row update error", clientUpdErr);
                  } else {
                    console.log("[Vault] client row updated: payment method persisted", {
                      vault_client_id: vaultClientId,
                      invoice_email: emailTrim,
                      card_last4: pmObj.card.last4 ?? null,
                    });
                  }
                }
              }
            }
          } else if (invoiceId) {
            console.log("[Vault] gate: vault not attempted (missing Connect account and/or PaymentIntent)", {
              invoice_id: invoiceId,
              has_connected_account: Boolean(connectedAccountId),
              connected_account_id: connectedAccountId ?? null,
              has_resolved_payment_intent: Boolean(paymentIntent?.id),
              payment_intent_id_from_session_field: paymentIntentId ?? null,
            });
            if (!connectedAccountId) {
              console.warn(
                "[Vault] skip: invoice_id present but event.account is missing — Connect direct charges require a connected-account webhook.",
              );
            } else if (!paymentIntent?.id) {
              console.warn(
                "[Vault] skip: PaymentIntent not available after session retrieve; cannot read save-card or vault PM.",
                { payment_intent_id_from_session: paymentIntentId },
              );
            }
          }
        } catch (vaultErr) {
          console.error("[stripe-webhook] vault persistence error (non-fatal):", vaultErr);
        }

        console.log("[stripe-webhook] checkout.session.completed handler finished", {
          session_id: session.id,
        });
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
        console.log("[stripe-webhook] unhandled event type (200 OK):", event.type);
    }

    // Return success response
    console.log("[stripe-webhook] → 200 received=true", event.type);
    return new Response(JSON.stringify({ received: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Internal server error";
    console.error("[stripe-webhook] → 400 top-level error:", errorMessage);
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
