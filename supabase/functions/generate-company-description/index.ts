import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.76.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TEMPLATE_WHO_WE_ARE = `{companyName} is a professional cleaning company specializing in commercial and residential cleaning services. Based in {address}, we are dedicated to providing reliable, efficient, and customized cleaning solutions to meet the specific needs of our clients. Our commitment is to create clean, safe, and healthy environments.
At {companyName}, we understand the importance of a pristine space. Our experienced team utilizes advanced techniques and high-quality products to ensure thorough and consistent results. We pride ourselves on our attention to detail and our ability to deliver exceptional service that exceeds expectations.
We are committed to fostering long-term relationships with our clients through trust and outstanding performance. {companyName} is your partner in maintaining a spotless and welcoming environment.`;

const TEMPLATE_WHY_CHOOSE_US = `When you partner with {companyName} in {address}, you are choosing a cleaning service dedicated to exceeding your expectations. Our foundation is built upon a team of highly trained and professional individuals committed to delivering impeccable results. We understand that your needs are unique, which is why we offer flexible scheduling options designed to fit seamlessly into your routine.
At {companyName}, we prioritize your convenience and satisfaction. Our robust 24/7 customer support ensures that assistance is always available, whenever you need it. We stand behind our commitment to punctuality with an on-time arrival guarantee, so you can rest assured your cleaning will be managed efficiently and without delay. Furthermore, we are proud to offer competitive pricing, delivering exceptional value without compromising on quality.`;

const TEMPLATE_OUR_SERVICES = `{companyName}, {address}, is dedicated to providing comprehensive solutions designed to enhance the appearance and hygiene of your commercial property. Our expert team offers thorough Services, ensuring your facilities are consistently maintained to the highest standards of cleanliness. This meticulous attention to detail not only creates a more pleasant environment for your employees and visitors but also contributes to a more productive workspace.
We specialize in Commercial Services, addressing all aspects of your business's upkeep, from daily tidying to deep services projects. Additionally, our professional Pressure Washing Services are available to revitalize the exterior of your building, removing dirt, grime, and environmental build-up to restore its curb appeal and protect your investment. Partner with {companyName} to experience a level of cleanliness that elevates your business.`;

const TEMPLATE_SERVICE_COVERAGE = `{companyName} is a professional organization specializing in providing comprehensive cleaning services. We are dedicated to delivering reliable, efficient, and customized cleaning solutions tailored to meet the diverse needs of our clients across various sectors. Our unwavering commitment is to foster clean, safe, and healthy environments for all our partners.
At {companyName}, we understand the critical role a pristine environment plays in operational success and well-being. Our experienced team utilizes advanced techniques and eco-friendly practices to ensure the highest standards are met. We pride ourselves on our meticulous attention to detail and our ability to adapt to specific client requirements, ensuring satisfaction with every service rendered.`;

/** Static clause bodies — same legal style as commercial estimate terms; no AI. */
const CLAUSE_TEMPLATES: Record<string, string> = {
  cancellationPolicy: `If the Client chooses to cancel the scheduled service after the fifty percent (50%) deposit has been paid, the Client may do so without penalty to the contract. However, only twenty-five percent (25%) of the total service price will be refunded to the Client. The remaining twenty-five percent (25%) shall be retained by {companyName} to cover administrative, scheduling, and operational costs. All cancellations must be submitted in writing. Refunds will be processed within a reasonable timeframe using the original payment method. Cancellation notices may be sent to {companyEmail} or by certified mail to {address}.`,

  noRefundClause: `{companyName} maintains a strict no-refund policy. Under no circumstances will refunds be issued for dissatisfaction with the service or for any other reason, once the services have commenced or been completed as described in this Agreement. By signing this Agreement, the Client acknowledges and agrees to this no-refund policy and waives any right to dispute charges or request reimbursement for services rendered.`,

  nonCompeteClause: `The Client agrees that, for the duration of this Agreement and for a period of twelve (12) months following its termination or completion, they shall not: directly or indirectly solicit, hire, or attempt to hire any employee, contractor, or subcontractor of {companyName} who was involved in the performance of services under this Agreement; or engage with or contract any individual or third party using confidential or proprietary information obtained through this Agreement with the intention of replicating or continuing similar services without the involvement of {companyName}. Any violation of this clause shall be considered a material breach of the Agreement and may result in legal action, including but not limited to injunctive relief and monetary damages, as permitted by law.`,

  antiHarassment: `The Client agrees to provide a safe, respectful, and harassment-free work environment for all employees and representatives of {companyName} throughout the duration of the services. Any form of harassment, discrimination, verbal abuse, intimidation, or inappropriate behavior by the Client or its staff toward {companyName} personnel shall be considered a serious breach of this Agreement and may result in the immediate suspension or termination of services, without refund or liability. {companyName} reserves the right to remove its staff from the job site at any time if working conditions are deemed unsafe, hostile, or inappropriate.`,

  liabilityInsurance: `{companyName} carries general liability insurance to cover its operations during the performance of the contracted services. The Client acknowledges that {companyName}'s liability for any claim arising out of this Agreement, whether in contract, tort, or otherwise, shall be limited to the total amount paid by the Client under this Agreement. {companyName} shall not be liable for any indirect, incidental, consequential, or punitive damages, including but not limited to loss of profits, business interruption, or loss of use. The Client agrees to indemnify, defend, and hold harmless {companyName}, its employees, agents, and subcontractors from and against any and all claims, damages, losses, or expenses arising out of or resulting from the Client's negligence or breach of this Agreement.`,

  confidentiality: `Both parties agree to maintain the confidentiality of any proprietary, sensitive, or confidential information disclosed during the term of this Agreement. Neither party shall disclose such information to any third party without the prior written consent of the other, except as required by law. This obligation shall survive the termination or expiration of this Agreement and remain in effect indefinitely.`,
};

type ProfileRow = {
  company_name: string | null;
  company_address: string | null;
  company_apt_suite: string | null;
  company_city: string | null;
  company_state: string | null;
  company_zip: string | null;
  company_email: string | null;
};

function formatAddressFromProfile(p: ProfileRow): string {
  const cityState = [p.company_city, p.company_state].filter(Boolean).join(", ");
  if (cityState) return cityState;
  const street = [p.company_address, p.company_apt_suite].filter(Boolean).join(", ").trim();
  if (street) return street;
  return "";
}

function interpolate(companyName: string, address: string, companyEmail: string, template: string): string {
  const name = companyName.trim() || "our company";
  const addr = address.trim() || "not specified";
  const email = companyEmail.trim() || "the company contact email on file";
  return template
    .replaceAll("{companyName}", name)
    .replaceAll("{address}", addr)
    .replaceAll("{companyEmail}", email);
}

async function getProfileForTemplates(
  req: Request,
): Promise<{ companyName: string; address: string; companyEmail: string } | { error: string; status: number }> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return { error: "Authentication required", status: 401 };
  }
  const token = authHeader.replace("Bearer ", "");
  const supabaseClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token);
  if (authError || !user?.id) {
    return { error: "Authentication required", status: 401 };
  }

  const { data: profile, error: profileError } = await supabaseClient
    .from("profiles")
    .select("company_name, company_address, company_apt_suite, company_city, company_state, company_zip, company_email")
    .eq("user_id", user.id)
    .maybeSingle();

  if (profileError) {
    console.error("generate-company-description profile error:", profileError);
    return { error: "Could not load profile", status: 500 };
  }

  const row = profile as ProfileRow | null;
  const companyName = row?.company_name?.trim() ?? "";
  const address = row ? formatAddressFromProfile(row) : "";
  const companyEmail = row?.company_email?.trim() ?? "";

  return { companyName, address, companyEmail };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }
    const type = body.type as string | undefined;
    const clauseType = body.clauseType as string | undefined;

    const staticTypes = new Set(["service_coverage", "our_services", "why_choose_us"]);
    const isWhoWeAre = type === undefined || type === null || type === "" || type === "who_we_are";

    if (staticTypes.has(type) || isWhoWeAre) {
      const resolved = await getProfileForTemplates(req);
      if ("error" in resolved) {
        return new Response(JSON.stringify({ error: resolved.error }), {
          status: resolved.status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { companyName, address, companyEmail } = resolved;

      let template: string;
      if (type === "service_coverage") template = TEMPLATE_SERVICE_COVERAGE;
      else if (type === "our_services") template = TEMPLATE_OUR_SERVICES;
      else if (type === "why_choose_us") template = TEMPLATE_WHY_CHOOSE_US;
      else template = TEMPLATE_WHO_WE_ARE;

      const description = interpolate(companyName, address, companyEmail, template);
      return new Response(JSON.stringify({ description }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (type === "contract_clause") {
      const tpl = clauseType ? CLAUSE_TEMPLATES[clauseType] : undefined;
      if (!tpl) {
        return new Response(JSON.stringify({ error: "Unknown or missing clauseType" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const resolved = await getProfileForTemplates(req);
      if ("error" in resolved) {
        return new Response(JSON.stringify({ error: resolved.error }), {
          status: resolved.status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { companyName, address, companyEmail } = resolved;
      const description = interpolate(companyName, address, companyEmail, tpl);
      return new Response(JSON.stringify({ description }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Unsupported type" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    console.error("generate-company-description error:", e);
    const message = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
