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

const SECTION_KEY_ORDER = [
  "scopeOfWork",
  "purposeOfAgreement",
  "priceAndPayment",
  "cancellationPolicy",
  "noRefundClause",
  "nonCompeteClause",
  "antiHarassment",
  "liabilityInsurance",
  "confidentiality",
] as const;

const COLOR_BLACK: [number, number, number] = [0, 0, 0];
const COLOR_BODY: [number, number, number] = [85, 85, 85];
const COLOR_MUTED: [number, number, number] = [120, 120, 120];
const COLOR_LINE: [number, number, number] = [224, 224, 224];

async function fetchLogoDataUrl(logoUrl: string | null | undefined): Promise<string | null> {
  if (!logoUrl || typeof logoUrl !== "string" || !logoUrl.startsWith("http")) return null;
  try {
    const res = await fetch(logoUrl);
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    let binary = "";
    for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i]);
    const b64 = btoa(binary);
    const ct = res.headers.get("content-type") || "image/png";
    if (!ct.startsWith("image/")) return null;
    return `data:${ct};base64,${b64}`;
  } catch {
    return null;
  }
}

/** Reference layout: cover (centered), About + Terms (left-aligned, light grays), signatures, page numbers. */
async function generateContractPdfBytes(contract: Record<string, unknown>, profile: Record<string, unknown>): Promise<Uint8Array> {
  const jsPDF = (await import("https://esm.sh/jspdf@2.5.1")).default;
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 20;
  const contentWidth = pageWidth - margin * 2;
  const footerReserve = 22;
  const bottomLimit = pageHeight - footerReserve;

  const companyName = String(profile?.company_name || "Company Name");
  const logoDataUrl = await fetchLogoDataUrl(profile?.company_logo as string | undefined);

  const formatDate = (d: string | null | undefined) => {
    if (!d) return "N/A";
    try {
      return new Date(d + (d.length <= 10 ? "T12:00:00Z" : "")).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
        timeZone: "UTC",
      });
    } catch {
      return String(d);
    }
  };

  const drawPageFooter = (pageIndex: number) => {
    const cx = pageWidth / 2;
    doc.setTextColor(COLOR_MUTED[0], COLOR_MUTED[1], COLOR_MUTED[2]);
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.text(`Page ${pageIndex}`, cx, pageHeight - 10, { align: "center" });
    doc.setTextColor(COLOR_BLACK[0], COLOR_BLACK[1], COLOR_BLACK[2]);
  };

  let pageNumber = 1;

  const newPage = () => {
    drawPageFooter(pageNumber);
    doc.addPage();
    pageNumber++;
    return margin;
  };

  const ensureSpace = (y: number, needed: number): number => {
    if (y + needed > bottomLimit) return newPage();
    return y;
  };

  // ── Page 1: Cover (centered) ───────────────────────────────────────────────
  let y = 36;
  if (logoDataUrl) {
    try {
      const w = 36;
      const xLogo = (pageWidth - w) / 2;
      const imgFmt = /image\/jpe?g/i.test(logoDataUrl) ? "JPEG" : "PNG";
      doc.addImage(logoDataUrl, imgFmt, xLogo, y, w, w, undefined, "FAST");
      y += w + 14;
    } catch {
      y += 4;
    }
  } else {
    y += 8;
  }

  doc.setTextColor(COLOR_BLACK[0], COLOR_BLACK[1], COLOR_BLACK[2]);
  doc.setFontSize(20);
  doc.setFont("helvetica", "bold");
  doc.text(companyName, pageWidth / 2, y, { align: "center" });
  y += 10;

  doc.setDrawColor(COLOR_LINE[0], COLOR_LINE[1], COLOR_LINE[2]);
  doc.setLineWidth(0.3);
  doc.line(margin + 25, y, pageWidth - margin - 25, y);
  y += 12;

  doc.setFontSize(13);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(55, 55, 55);
  doc.text("Service Agreement", pageWidth / 2, y, { align: "center" });
  y += 10;

  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(COLOR_MUTED[0], COLOR_MUTED[1], COLOR_MUTED[2]);
  doc.text(`Contract #${String(contract.contract_number || "")}`, pageWidth / 2, y, { align: "center" });
  y += 18;

  doc.setFontSize(9);
  doc.text("Prepared for:", pageWidth / 2, y, { align: "center" });
  y += 7;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(COLOR_BLACK[0], COLOR_BLACK[1], COLOR_BLACK[2]);
  doc.text(String(contract.recipient_name || ""), pageWidth / 2, y, { align: "center" });
  y += 16;

  const startD = contract.start_date as string | null;
  const endD = contract.end_date as string | null;
  const periodStr = startD && endD ? `${formatDate(startD)} — ${formatDate(endD)}` : "N/A";
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(COLOR_BODY[0], COLOR_BODY[1], COLOR_BODY[2]);
  doc.text(`Period: ${periodStr}`, pageWidth / 2, y, { align: "center" });
  y = pageHeight - 52;

  const addr1 = [profile?.company_address, profile?.company_city, profile?.company_state, profile?.company_zip]
    .filter(Boolean)
    .join(", ");
  doc.setFontSize(8);
  doc.setTextColor(COLOR_MUTED[0], COLOR_MUTED[1], COLOR_MUTED[2]);
  if (profile?.company_address) {
    doc.text(String(profile.company_address), pageWidth / 2, y, { align: "center" });
    y += 4;
  }
  if (addr1 && profile?.company_address !== addr1) {
    doc.text(addr1, pageWidth / 2, y, { align: "center" });
    y += 4;
  }
  if (profile?.company_phone) {
    doc.text(String(profile.company_phone), pageWidth / 2, y, { align: "center" });
    y += 4;
  }
  if (profile?.company_email) {
    doc.text(String(profile.company_email), pageWidth / 2, y, { align: "center" });
  }

  drawPageFooter(pageNumber);
  doc.addPage();
  pageNumber++;
  y = margin;

  // ── About {Company} ────────────────────────────────────────────────────────
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(COLOR_BLACK[0], COLOR_BLACK[1], COLOR_BLACK[2]);
  doc.text(`About ${companyName}`, margin, y);
  y += 7;
  doc.setDrawColor(COLOR_LINE[0], COLOR_LINE[1], COLOR_LINE[2]);
  doc.line(margin, y, pageWidth - margin, y);
  y += 12;

  const aboutBlocks: { title: string; body: string }[] = [
    { title: "Who We Are", body: String(contract.who_we_are || "") },
    { title: "Why Choose Us", body: String(contract.why_choose_us || "") },
    { title: "Our Services", body: String(contract.our_services || "") },
    { title: "Service Coverage", body: String(contract.service_coverage || "") },
  ];

  const addAboutBlock = (title: string, body: string) => {
    if (!body.trim()) return;
    const lines = doc.splitTextToSize(body, contentWidth);
    const blockH = 8 + 5 + lines.length * 5 + 10;
    y = ensureSpace(y, blockH);
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(COLOR_BLACK[0], COLOR_BLACK[1], COLOR_BLACK[2]);
    doc.text(title, margin, y);
    y += 7;
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(COLOR_BODY[0], COLOR_BODY[1], COLOR_BODY[2]);
    for (const line of lines) {
      y = ensureSpace(y, 6);
      doc.text(line, margin, y);
      y += 5;
    }
    y += 8;
  };

  for (const b of aboutBlocks) addAboutBlock(b.title, b.body);

  // ── Terms & Conditions (all clause sections + custom) ─────────────────────
  const sections = (contract.sections as Record<string, unknown>) || {};
  const customTitles = (contract.custom_clause_titles as Record<string, string>) || {};
  const rawEntries = Object.entries(sections).filter(
    (e): e is [string, string] => typeof e[1] === "string" && e[1].trim().length > 0,
  );
  const orderSet = new Set<string>(SECTION_KEY_ORDER as unknown as string[]);
  const ordered: [string, string][] = [];
  for (const k of SECTION_KEY_ORDER) {
    const found = rawEntries.find(([key]) => key === k);
    if (found) ordered.push(found);
  }
  for (const e of rawEntries) {
    if (!orderSet.has(e[0])) ordered.push(e);
  }

  if (ordered.length > 0) {
    const headerH = 28;
    y = ensureSpace(y, headerH);
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(COLOR_BLACK[0], COLOR_BLACK[1], COLOR_BLACK[2]);
    doc.text("Terms & Conditions", margin, y);
    y += 8;
    doc.setDrawColor(COLOR_LINE[0], COLOR_LINE[1], COLOR_LINE[2]);
    doc.line(margin, y, pageWidth - margin, y);
    y += 12;

    for (const [key, value] of ordered) {
      const title = SECTION_TITLES[key] || customTitles[key] || key;
      doc.setFontSize(10);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(COLOR_BLACK[0], COLOR_BLACK[1], COLOR_BLACK[2]);
      const titleLines = doc.splitTextToSize(title, contentWidth);
      for (const tl of titleLines) {
        y = ensureSpace(y, 6);
        doc.text(tl, margin, y);
        y += 5;
      }
      y += 3;
      doc.setFont("helvetica", "normal");
      doc.setTextColor(COLOR_BODY[0], COLOR_BODY[1], COLOR_BODY[2]);
      const bodyLines = doc.splitTextToSize(value, contentWidth);
      for (const line of bodyLines) {
        y = ensureSpace(y, 6);
        doc.text(line, margin, y);
        y += 5;
      }
      y += 8;
    }
  }

  // ── Contract summary (footer info: total & payment) ───────────────────────
  const summaryLines = [
    `Total: $${formatCurrency(Number(contract.total))}`,
    `Payment frequency: ${String(contract.payment_frequency || "—")}`,
  ];
  for (const line of summaryLines) {
    y = ensureSpace(y, 8);
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(COLOR_BODY[0], COLOR_BODY[1], COLOR_BODY[2]);
    doc.text(line, margin, y);
    y += 7;
  }
  y += 6;

  // ── Signatures ─────────────────────────────────────────────────────────────
  const sigIntro =
    `By signing below, both parties acknowledge that they have read, understood, and agree to all terms and conditions outlined in this Service Agreement (Contract #${String(contract.contract_number || "")}).`;
  const introLines = doc.splitTextToSize(sigIntro, contentWidth);
  const sigBlockH = 12 + introLines.length * 5 + 8 + 14 + 28 + 6 + 28 + 6 + 28;
  y = ensureSpace(y, sigBlockH);

  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(COLOR_BLACK[0], COLOR_BLACK[1], COLOR_BLACK[2]);
  doc.text("Signatures", margin, y);
  y += 8;
  doc.setDrawColor(COLOR_LINE[0], COLOR_LINE[1], COLOR_LINE[2]);
  doc.line(margin, y, pageWidth - margin, y);
  y += 10;

  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(COLOR_BODY[0], COLOR_BODY[1], COLOR_BODY[2]);
  for (const il of introLines) {
    doc.text(il, margin, y);
    y += 5;
  }
  y += 10;

  const colGap = 14;
  const colW = (contentWidth - colGap) / 2;
  const xRight = margin + colW + colGap;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(COLOR_BLACK[0], COLOR_BLACK[1], COLOR_BLACK[2]);
  const leftHead = doc.splitTextToSize(companyName, colW);
  for (let i = 0; i < leftHead.length; i++) {
    doc.text(leftHead[i]!, margin, y + i * 5);
  }
  doc.text("Client", xRight, y);
  y += Math.max(leftHead.length * 5, 5) + 14;

  const drawSigColumn = (x: number, w: number) => {
    let yy = y;
    doc.setDrawColor(180, 180, 180);
    doc.line(x, yy, x + w, yy);
    yy += 5;
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(COLOR_MUTED[0], COLOR_MUTED[1], COLOR_MUTED[2]);
    doc.text("Authorized Signature", x, yy);
    yy += 22;
    doc.line(x, yy, x + w, yy);
    yy += 5;
    doc.text("Printed Name", x, yy);
    yy += 22;
    doc.line(x, yy, x + w, yy);
    yy += 5;
    doc.text("Date", x, yy);
    return yy + 4;
  };

  const yAfterLeft = drawSigColumn(margin, colW);
  doc.setTextColor(COLOR_BLACK[0], COLOR_BLACK[1], COLOR_BLACK[2]);
  const yAfterRight = drawSigColumn(xRight, colW);
  y = Math.max(yAfterLeft, yAfterRight);

  drawPageFooter(pageNumber);

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
