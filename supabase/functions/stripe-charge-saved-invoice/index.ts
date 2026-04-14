// Supabase Edge Function: stripe-charge-saved-invoice
// Charge a pending invoice using the client's saved PaymentMethod (Connect direct charge).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";
import Stripe from "https://esm.sh/stripe@14.14.0?target=deno";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface ChargeRequest {
  invoiceId: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
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

    const body: ChargeRequest = await req.json();
    if (!body.invoiceId) {
      throw new Error("invoiceId is required");
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("stripe_account_id, stripe_charges_enabled")
      .eq("user_id", user.id)
      .single();

    if (profileError || !profile?.stripe_account_id) {
      throw new Error("Stripe account not connected");
    }

    const { data: invoice, error: invoiceError } = await supabase
      .from("invoices")
      .select("*")
      .eq("id", body.invoiceId)
      .single();

    if (invoiceError || !invoice) {
      throw new Error("Invoice not found");
    }

    if (invoice.user_id !== user.id) {
      throw new Error("Forbidden");
    }

    if (invoice.status !== "Pending") {
      throw new Error("Invoice must be Pending to charge");
    }

    const totalNum = Number(invoice.total);
    const amountCents = Math.round(totalNum * 100);
    if (!amountCents || amountCents < 50) {
      throw new Error("Invalid invoice amount");
    }

    const payerEmail = (invoice.email as string)?.trim();
    if (!payerEmail) {
      throw new Error("Invoice has no payer email");
    }

    const { data: clientRow, error: clientErr } = await supabase
      .from("clients")
      .select(
        "id, stripe_customer_id, stripe_default_payment_method_id",
      )
      .eq("user_id", user.id)
      .eq("email", payerEmail)
      .limit(1)
      .maybeSingle();

    if (clientErr || !clientRow?.stripe_customer_id || !clientRow?.stripe_default_payment_method_id) {
      throw new Error("No saved card on file for this client email");
    }

    const applicationFeeAmount = 0;

    const pi = await stripe.paymentIntents.create(
      {
        amount: amountCents,
        currency: "usd",
        customer: clientRow.stripe_customer_id,
        payment_method: clientRow.stripe_default_payment_method_id,
        off_session: true,
        confirm: true,
        application_fee_amount: applicationFeeAmount,
        metadata: {
          merchant_user_id: user.id,
          invoice_id: body.invoiceId,
          invoice_number: String(invoice.invoice_number ?? ""),
        },
      },
      { stripeAccount: profile.stripe_account_id },
    );

    if (pi.status !== "succeeded") {
      throw new Error(
        `Payment not completed (status: ${pi.status}). The bank may require the customer to pay again online.`,
      );
    }

    const paidNow = new Date().toISOString();
    const paidDate = paidNow.split("T")[0];

    const { error: invUpdErr } = await supabase
      .from("invoices")
      .update({
        status: "Paid",
        paid_at: paidNow,
        paid_date: paidDate,
        stripe_payment_intent_id: pi.id,
        stripe_session_id: null,
        payment_method: "Card on file",
      })
      .eq("id", body.invoiceId);

    if (invUpdErr) {
      console.error("Invoice update after charge failed:", invUpdErr);
      throw new Error("Payment succeeded but failed to update invoice — contact support");
    }

    const { error: payInsErr } = await supabase.from("payments").insert({
      user_id: user.id,
      invoice_id: body.invoiceId,
      amount: totalNum,
      currency: "usd",
      status: "succeeded",
      stripe_payment_intent_id: pi.id,
      stripe_session_id: null,
      payment_method: "card",
      metadata: {
        source: "stripe-charge-saved-invoice",
        charged_at: paidNow,
      },
    });

    if (payInsErr) {
      console.error("payments insert after charge:", payInsErr);
    }

    try {
      await supabase.functions.invoke("send-invoice-email", {
        body: { invoiceId: body.invoiceId, isPaymentConfirmation: true },
      });
    } catch (emailErr) {
      console.error("send-invoice-email after saved charge:", emailErr);
    }

    try {
      await supabase.from("notifications").insert({
        user_id: user.id,
        type: "invoice_paid",
        title: "Invoice Paid",
        message: `Invoice ${invoice.invoice_number} for ${invoice.client_name} has been paid ($${totalNum})`,
        related_id: body.invoiceId,
        related_type: "invoice",
      });
      await supabase.from("activities").insert({
        user_id: user.id,
        type: "invoice_paid",
        title: `Invoice ${invoice.invoice_number} marked as paid`,
        invoice_number: invoice.invoice_number || "",
        client_name: invoice.client_name || "",
        amount: invoice.total || 0,
        metadata: {
          source: "stripe-charge-saved-invoice",
          payment_intent_id: pi.id,
        },
      });
    } catch (notifyErr) {
      console.error("notification/activity after charge:", notifyErr);
    }

    return new Response(
      JSON.stringify({
        success: true,
        paymentIntentId: pi.id,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      },
    );
  } catch (error) {
    console.error("stripe-charge-saved-invoice:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Internal server error",
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      },
    );
  }
});
