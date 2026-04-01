import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.76.1";
import * as Sentry from "npm:@sentry/deno";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Sentry.init({
  dsn: "https://ce035a76b6157a602d88c53eab6570e4@o4509804047958016.ingest.us.sentry.io/4510552540971008",
  environment: Deno.env.get("SUPABASE_URL")?.includes("staging") ? "staging" : "production",
  tracesSampleRate: 0.1,
});

const SECTION_TITLES: Record<string, string> = {
  scopeOfWork: "Scope of Work",
  purposeOfAgreement: "Purpose of the Agreement",
  priceAndPayment: "Price and Payment Terms",
  cancellationPolicy: "Cancellation Policy",
  noRefundClause: "No Refund Clause",
  nonCompeteClause: "Non-Compete Clause",
  antiHarassment: "Anti-Harassment and Respect Policy",
  liabilityInsurance: "Liability and Insurance",
  confidentiality: "Confidentiality",
};

function formatCurrency(n: number): string {
  return (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** PDF layout matches download-estimate-pdf generateEstimatePDF (commercial/residential estimate style). */
async function generateContractPdfBytes(contract: Record<string, unknown>, profile: Record<string, unknown>): Promise<Uint8Array> {
  const jsPDF = (await import("https://esm.sh/jspdf@2.5.1")).default;
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 20;
  const contentWidth = pageWidth - margin * 2;
  const darkBlue = [30, 58, 138] as const;
  const lightGreen = [240, 253, 244] as const;
  const darkGrey = [51, 51, 51] as const;

  const companyName = String(profile?.company_name || "Company Name");
  const formatDate = (d: string | null | undefined) => {
    if (!d) return "N/A";
    try {
      return new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    } catch {
      return String(d);
    }
  };

  const drawHeader = () => {
    let y = 0;
    doc.setFillColor(darkBlue[0], darkBlue[1], darkBlue[2]);
    doc.rect(0, y, pageWidth, 25, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(18);
    doc.setFont("helvetica", "bold");
    doc.text(companyName, pageWidth / 2, y + 10, { align: "center" });
    doc.setFontSize(11);
    doc.setFont("helvetica", "normal");
    doc.text("Service Agreement", pageWidth / 2, y + 18, { align: "center" });
    return 35;
  };

  const drawFooter = () => {
    const footerY = pageHeight - 20;
    doc.setFillColor(darkBlue[0], darkBlue[1], darkBlue[2]);
    doc.rect(0, footerY, pageWidth, 20, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.text("Service provided by", pageWidth / 2, footerY + 6, { align: "center" });
    doc.text("© 2024 Thunder Pro Inc. | www.thunderpro.co", pageWidth / 2, footerY + 14, { align: "center" });
  };

  let yPosition = drawHeader();
  yPosition += 10;

  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(darkBlue[0], darkBlue[1], darkBlue[2]);
  doc.text("Client Information", margin, yPosition);
  yPosition += 5;
  doc.setDrawColor(darkBlue[0], darkBlue[1], darkBlue[2]);
  doc.setLineWidth(0.5);
  doc.line(margin, yPosition, pageWidth - margin, yPosition);
  yPosition += 8;

  doc.setFontSize(10);
  doc.setTextColor(darkGrey[0], darkGrey[1], darkGrey[2]);
  const clientLines = [
    ["Name:", String(contract.recipient_name || "")],
    ["Email:", String(contract.recipient_email || "")],
    ["Phone:", String(contract.recipient_phone || "")],
    ["Address:", String(contract.recipient_address || "")],
  ];
  for (const [label, val] of clientLines) {
    doc.setFont("helvetica", "bold");
    doc.text(label, margin, yPosition);
    doc.setFont("helvetica", "normal");
    doc.text(val || "—", margin + 28, yPosition);
    yPosition += 5;
  }
  yPosition += 8;

  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(darkBlue[0], darkBlue[1], darkBlue[2]);
  doc.text("Contract Details", margin, yPosition);
  yPosition += 5;
  doc.line(margin, yPosition, pageWidth - margin, yPosition);
  yPosition += 8;

  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(darkGrey[0], darkGrey[1], darkGrey[2]);
  const startD = contract.start_date as string | null;
  const endD = contract.end_date as string | null;
  const period = startD && endD ? `${formatDate(startD)} — ${formatDate(endD)}` : "N/A";
  const details = [
    ["Contract #:", String(contract.contract_number || "")],
    ["Period:", period],
    ["Total:", `$${formatCurrency(Number(contract.total))}`],
    ["Payment frequency:", String(contract.payment_frequency || "—")],
  ];
  for (const [label, val] of details) {
    doc.setFont("helvetica", "bold");
    doc.text(label, margin, yPosition);
    doc.setFont("helvetica", "normal");
    doc.text(val, margin + 40, yPosition);
    yPosition += 5;
  }
  yPosition += 10;

  doc.setFillColor(lightGreen[0], lightGreen[1], lightGreen[2]);
  doc.rect(margin, yPosition - 4, contentWidth, 22, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(darkBlue[0], darkBlue[1], darkBlue[2]);
  doc.text("Contract Value", margin + 8, yPosition + 6);
  doc.text(`$${formatCurrency(Number(contract.total))}`, pageWidth - margin - 8, yPosition + 6, { align: "right" });
  yPosition += 28;

  const aboutBlocks: { title: string; body: string }[] = [
    { title: "Who We Are", body: String(contract.who_we_are || "") },
    { title: "Why Choose Us", body: String(contract.why_choose_us || "") },
    { title: "Our Services", body: String(contract.our_services || "") },
    { title: "Service Coverage", body: String(contract.service_coverage || "") },
  ];

  const addParagraphSection = (title: string, body: string) => {
    if (!body?.trim()) return;
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(darkBlue[0], darkBlue[1], darkBlue[2]);
    doc.text(title, margin, yPosition);
    yPosition += 5;
    doc.line(margin, yPosition, pageWidth - margin, yPosition);
    yPosition += 8;
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(darkGrey[0], darkGrey[1], darkGrey[2]);
    const lines = doc.splitTextToSize(body, contentWidth);
    for (const line of lines) {
      if (yPosition > pageHeight - 40) {
        drawFooter();
        doc.addPage();
        yPosition = drawHeader() + 10;
      }
      doc.text(line, margin, yPosition);
      yPosition += 5;
    }
    yPosition += 8;
  };

  for (const b of aboutBlocks) addParagraphSection(b.title, b.body);

  const sections = (contract.sections as Record<string, unknown>) || {};
  const customTitles = (contract.custom_clause_titles as Record<string, string>) || {};
  const entries = Object.entries(sections).filter(
    (e): e is [string, string] => typeof e[1] === "string" && e[1].trim().length > 0,
  );

  if (entries.length > 0) {
    if (yPosition > pageHeight - 80) {
      drawFooter();
      doc.addPage();
      yPosition = drawHeader() + 10;
    }
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(darkBlue[0], darkBlue[1], darkBlue[2]);
    doc.text("Terms & Conditions", margin, yPosition);
    yPosition += 5;
    doc.line(margin, yPosition, pageWidth - margin, yPosition);
    yPosition += 10;

    for (const [key, value] of entries) {
      const title = SECTION_TITLES[key] || customTitles[key] || key;
      doc.setFontSize(10);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(darkGrey[0], darkGrey[1], darkGrey[2]);
      const titleLines = doc.splitTextToSize(title, contentWidth);
      for (const tl of titleLines) {
        if (yPosition > pageHeight - 40) {
          drawFooter();
          doc.addPage();
          yPosition = drawHeader() + 10;
        }
        doc.text(tl, margin, yPosition);
        yPosition += 5;
      }
      yPosition += 2;
      doc.setFont("helvetica", "normal");
      const bodyLines = doc.splitTextToSize(value, contentWidth);
      for (const line of bodyLines) {
        if (yPosition > pageHeight - 40) {
          drawFooter();
          doc.addPage();
          yPosition = drawHeader() + 10;
        }
        doc.text(line, margin, yPosition);
        yPosition += 5;
      }
      yPosition += 6;
    }
  }

  if (yPosition > pageHeight - 50) {
    drawFooter();
    doc.addPage();
    yPosition = drawHeader() + 10;
  } else {
    yPosition += 10;
  }

  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(darkBlue[0], darkBlue[1], darkBlue[2]);
  doc.text("Signatures", margin, yPosition);
  yPosition += 6;
  doc.line(margin, yPosition, pageWidth - margin, yPosition);
  yPosition += 12;

  const colW = contentWidth / 2 - 8;
  const x2 = margin + colW + 16;
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.text(companyName, margin, yPosition);
  doc.text("Client", x2, yPosition);
  yPosition += 40;
  doc.setDrawColor(160, 160, 160);
  doc.line(margin, yPosition, margin + colW, yPosition);
  doc.line(x2, yPosition, x2 + colW, yPosition);
  yPosition += 5;
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(130, 130, 130);
  doc.text("Authorized Signature", margin, yPosition);
  doc.text("Authorized Signature", x2, yPosition);

  drawFooter();

  const pdfOutput = doc.output("arraybuffer");
  return new Uint8Array(pdfOutput);
}

async function loadContract(
  supabase: ReturnType<typeof createClient>,
  id: string,
): Promise<{ contract: Record<string, unknown> | null; profile: Record<string, unknown> | null }> {
  const { data: contract, error: cErr } = await supabase.from("contracts").select("*").eq("id", id).maybeSingle();
  if (cErr || !contract) return { contract: null, profile: null };
  const { data: profile } = await supabase.from("profiles").select("*").eq("user_id", contract.user_id).maybeSingle();
  return { contract: contract as Record<string, unknown>, profile: profile as Record<string, unknown> | null };
}

serve(async (req: Request): Promise<Response> => {
  return await Sentry.withScope(async () => {
    Sentry.setTag("function", "download-contract-pdf");
    if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
      const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

      const supabaseAdmin = createClient(supabaseUrl, serviceKey);

      // GET ?token= — public download (email link)
      if (req.method === "GET") {
        const url = new URL(req.url);
        const token = url.searchParams.get("token");
        if (!token) {
          return new Response(JSON.stringify({ error: "Missing token parameter" }), {
            status: 400,
            headers: { "Content-Type": "application/json", ...corsHeaders },
          });
        }
        const { data: byToken } = await supabaseAdmin.from("contracts").select("*").eq("public_share_token", token).maybeSingle();
        let contractRow = byToken;
        if (!contractRow) {
          const { data: byId } = await supabaseAdmin.from("contracts").select("*").eq("id", token).maybeSingle();
          contractRow = byId;
        }
        if (!contractRow) {
          return new Response(JSON.stringify({ error: "Contract not found" }), {
            status: 404,
            headers: { "Content-Type": "application/json", ...corsHeaders },
          });
        }

        // Same as mark-viewed?type=contract: first open of PDF link sets viewed_at and Sent → Pending
        const row = contractRow as { id: string; viewed_at?: string | null; status?: string | null };
        if (!row.viewed_at) {
          const now = new Date().toISOString();
          const updates: Record<string, string> = { viewed_at: now, updated_at: now };
          if (String(row.status || "") === "Sent") {
            updates.status = "Pending";
          }
          await supabaseAdmin.from("contracts").update(updates).eq("id", row.id);
        }

        const { data: profile } = await supabaseAdmin.from("profiles").select("*").eq("user_id", contractRow.user_id).maybeSingle();
        const pdfBytes = await generateContractPdfBytes(contractRow as Record<string, unknown>, profile || {});
        const num = String((contractRow as { contract_number?: string }).contract_number || "contract");
        return new Response(pdfBytes, {
          status: 200,
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `attachment; filename="Contract_${num.replace(/\s+/g, "_")}.pdf"`,
            ...corsHeaders,
          },
        });
      }

      if (req.method !== "POST") {
        return new Response(JSON.stringify({ error: "Method not allowed" }), {
          status: 405,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }

      const authHeader = req.headers.get("Authorization");
      if (!authHeader) {
        return new Response(JSON.stringify({ error: "Authentication required" }), {
          status: 401,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }

      const { contractId } = await req.json() as { contractId?: string };
      if (!contractId) {
        return new Response(JSON.stringify({ error: "contractId required" }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }

      const token = authHeader.replace("Bearer ", "");
      const supabaseUser = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
      const { data: { user }, error: authErr } = await supabaseUser.auth.getUser(token);
      if (authErr || !user?.id) {
        return new Response(JSON.stringify({ error: "Authentication required" }), {
          status: 401,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }

      const { data: contract, error: cErr } = await supabaseUser.from("contracts").select("*").eq("id", contractId).maybeSingle();
      if (cErr || !contract || contract.user_id !== user.id) {
        return new Response(JSON.stringify({ error: "Contract not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }

      const { data: profile } = await supabaseUser.from("profiles").select("*").eq("user_id", user.id).maybeSingle();
      const pdfBytes = await generateContractPdfBytes(contract as Record<string, unknown>, profile || {});
      const num = String((contract as { contract_number?: string }).contract_number || "contract");
      return new Response(pdfBytes, {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="Contract_${num.replace(/\s+/g, "_")}.pdf"`,
          ...corsHeaders,
        },
      });
    } catch (e: unknown) {
      Sentry.captureException(e);
      const message = e instanceof Error ? e.message : String(e);
      return new Response(JSON.stringify({ error: message }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }
  });
});
