import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as Sentry from "npm:@sentry/deno";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Sentry.init({
  dsn: "https://ce035a76b6157a602d88c53eab6570e4@o4509804047958016.ingest.us.sentry.io/4510552540971008",
  environment: Deno.env.get("SUPABASE_URL")?.includes("staging") ? "staging" : "production",
  tracesSampleRate: 0.1,
});

interface PaymentRequest {
  invoiceId: string;
  paymentMethod?: string;
}

serve(async (req) => {
  return await Sentry.withScope(async (scope) => {
    Sentry.setTag("function", "process-invoice-payment");

    if (req.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      const { invoiceId, paymentMethod = "online" }: PaymentRequest = await req.json();
      console.log("Processing payment for invoice:", invoiceId);

      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const supabase = createClient(supabaseUrl, supabaseKey);

      const { data: invoice, error: invoiceError } = await supabase
        .from("invoices")
        .select("*")
        .eq("id", invoiceId)
        .single();

      if (invoiceError || !invoice) {
        throw new Error("Invoice not found");
      }

      if (invoice.status === "Paid") {
        throw new Error("Invoice already paid");
      }

      const { error: updateError } = await supabase
        .from("invoices")
        .update({
          status: "Paid",
          payment_method: paymentMethod,
          paid_date: new Date().toISOString().split("T")[0],
        })
        .eq("id", invoiceId);

      if (updateError) {
        throw updateError;
      }

      const { error: paymentError } = await supabase.from("payments").insert({
        user_id: invoice.user_id,
        invoice_id: invoiceId,
        amount: invoice.total,
        currency: "usd",
        status: "succeeded",
        payment_method: paymentMethod,
        metadata: {
          source: "process-invoice-payment",
          processed_at: new Date().toISOString(),
        },
      });

      if (paymentError) {
        console.error("Error recording payment:", paymentError);
      }

      try {
        const { error: emailErr } = await supabase.functions.invoke("send-invoice-email", {
          body: { invoiceId, isPaymentConfirmation: true },
        });
        if (emailErr) console.error("send-invoice-email (paid):", emailErr);
      } catch (e) {
        console.error("send-invoice-email invoke failed:", e);
      }

      return new Response(
        JSON.stringify({
          success: true,
          message: "Payment processed. Confirmation emails are being sent to the client and your business email.",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    } catch (error: unknown) {
      Sentry.captureException(error);
      const message = error instanceof Error ? error.message : String(error);
      console.error("Error in process-invoice-payment:", message);
      return new Response(JSON.stringify({ error: message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  });
});
