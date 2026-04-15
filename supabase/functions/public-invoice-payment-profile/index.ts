// Public: minimal merchant branding + Stripe Connect flags for the invoice pay page (anon-safe).
// RLS blocks anon from reading profiles; this uses the service role after validating invoice access.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = (await req.json()) as { invoiceId?: string };
    const invoiceId = typeof body.invoiceId === "string" ? body.invoiceId.trim() : "";
    if (!invoiceId) {
      return new Response(JSON.stringify({ error: "invoiceId required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: inv, error: invErr } = await supabase
      .from("invoices")
      .select("id, user_id, status, company_name")
      .eq("id", invoiceId)
      .maybeSingle();

    if (invErr || !inv) {
      return new Response(JSON.stringify({ error: "Invoice not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (inv.status === "Draft") {
      return new Response(JSON.stringify({ error: "Invoice not available" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: profile, error: profErr } = await supabase
      .from("profiles")
      .select(
        "company_name, company_logo, company_phone, stripe_account_id, stripe_onboarding_completed, stripe_charges_enabled",
      )
      .eq("user_id", inv.user_id)
      .maybeSingle();

    if (profErr || !profile) {
      return new Response(JSON.stringify({ error: "Merchant profile not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({
        company_name: profile.company_name ?? inv.company_name ?? null,
        company_logo: profile.company_logo ?? null,
        company_phone: profile.company_phone ?? null,
        stripe_account_id: profile.stripe_account_id ?? null,
        stripe_onboarding_completed: profile.stripe_onboarding_completed ?? false,
        stripe_charges_enabled: profile.stripe_charges_enabled ?? false,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Internal error";
    console.error("public-invoice-payment-profile:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
