import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.76.1";
import { formatDateOnlyLong } from "../_shared/formatDateOnly.ts";
import { formatJobClock, jobFrequencyLabel, jobServiceLabel } from "../_shared/jobConfirmationCard.ts";
import { drawInitialsLogo } from "../_shared/pdfInitialsLogo.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function loadLogoForPdf(src: string | null | undefined): Promise<{ data: string; format: string } | null> {
  if (!src) return null;
  if (src.startsWith("data:image/png")) return { data: src, format: "PNG" };
  if (src.startsWith("data:image/jpeg") || src.startsWith("data:image/jpg")) return { data: src, format: "JPEG" };
  if (!src.startsWith("http")) return null;
  try {
    const res = await fetch(src);
    if (!res.ok) return null;
    const type = (res.headers.get("content-type") || "").toLowerCase();
    const format = type.includes("png") ? "PNG" : type.includes("jpeg") || type.includes("jpg") ? "JPEG" : null;
    if (!format) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return { data: `data:${format === "PNG" ? "image/png" : "image/jpeg"};base64,${btoa(binary)}`, format };
  } catch {
    return null;
  }
}

function formatSheetPhone(raw: string): string {
  if (!raw?.trim()) return "";
  const digits = raw.replace(/\D/g, "");
  const local = digits.length > 10 ? digits.slice(-10) : digits;
  if (local.length !== 10) return raw.trim();
  return `(${local.slice(0, 3)})${local.slice(3, 6)}-${local.slice(6)}`;
}

function money(value: number): string {
  return `$${(Number(value) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

type SheetLine = { description: string; qty: number; price: number | null; amount: number | null };

function jobLines(job: Record<string, unknown>, subtotal: number, serviceType: string): SheetLine[] {
  const raw = Array.isArray(job.line_items) ? job.line_items : [];
  const lines: SheetLine[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const description = String(row.name || row.description || "").trim();
    const qty = Number(row.quantity ?? row.qty ?? 1);
    const price = Number(row.unit_price ?? row.unitPrice ?? row.price ?? 0);
    const amount = Number(row.total ?? (Number.isFinite(qty) && Number.isFinite(price) ? qty * price : 0));
    if (!description) continue;
    lines.push({
      description,
      qty: Number.isFinite(qty) && qty > 0 ? qty : 1,
      price: Number.isFinite(price) ? price : 0,
      amount: Number.isFinite(amount) ? amount : 0,
    });
  }
  if (lines.length === 0) {
    const details = String(job.service_details || "").trim();
    lines.push({
      description: details || serviceType || "Cleaning service",
      qty: 1,
      price: subtotal,
      amount: subtotal,
    });
  }
  return lines;
}

async function generateJobPDF(job: Record<string, unknown>, profile: Record<string, unknown>): Promise<Uint8Array> {
  const jsPDF = (await import("https://esm.sh/jspdf@2.5.1")).default;
  const doc = new jsPDF({ unit: "mm", format: "letter" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 12;
  const contentWidth = pageWidth - margin * 2;
  const navy = [18, 52, 99];

  const companyName = String(profile.company_name || "");
  const companyAddress = String(profile.company_address || "");
  const companyCity = [profile.company_city, profile.company_state, profile.company_zip].filter(Boolean).join(" , ");
  const companyPhone = String(profile.company_phone || "");
  const companyEmail = String(profile.company_email || "");
  const serviceType = jobServiceLabel(String(job.service_type || ""));
  const frequency = jobFrequencyLabel(
    job.job_type == null ? null : String(job.job_type),
    job.recurring_frequency == null ? null : String(job.recurring_frequency),
  );
  const number = String(job.id || "").substring(0, 8).toUpperCase();
  const subtotal = Number(job.subtotal) || 0;
  const discount = Number(job.discount_amount) || 0;
  const tax = Number(job.tax_amount) || 0;
  const total = Number(job.total_amount) || 0;
  const deposit = Number(job.deposit_amount) || 0;
  const pending = job.balance_due == null ? Math.max(0, total - deposit) : Number(job.balance_due) || 0;
  const lines = jobLines(job, subtotal, serviceType);
  const dateLabel = formatDateOnlyLong(job.scheduled_date == null ? "" : String(job.scheduled_date));
  const startTime = formatJobClock(job.start_time == null ? "" : String(job.start_time));
  const endTime = formatJobClock(job.end_time == null ? "" : String(job.end_time));

  let y = margin;
  doc.setFillColor(navy[0], navy[1], navy[2]);
  doc.rect(margin, y, contentWidth, 10, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("PROFESSIONAL CLEANING JOB", pageWidth / 2, y + 6.6, { align: "center" });
  y += 16;

  const logoSize = 22;
  const logoData = await loadLogoForPdf(profile.company_logo == null ? null : String(profile.company_logo));
  let drewLogo = false;
  if (logoData) {
    try {
      doc.addImage(logoData.data, logoData.format, margin, y, logoSize, logoSize);
      drewLogo = true;
    } catch { /* a logo the PDF library cannot draw falls through to initials */ }
  }
  if (!drewLogo) drewLogo = drawInitialsLogo(doc, margin, y, logoSize, companyName);
  const textX = margin + (drewLogo ? logoSize + 4 : 0);
  doc.setTextColor(0, 0, 0);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(companyName, textX, y + 6);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  const phoneStr = formatSheetPhone(companyPhone);
  const leftColW = Math.max(doc.getTextWidth(companyAddress), doc.getTextWidth(phoneStr));
  const pipeX = textX + leftColW + 3;
  const rightTextX = pipeX + doc.getTextWidth("|") + 3;
  let infoY = y + 12;
  if (companyAddress || companyCity) {
    if (companyAddress) doc.text(companyAddress, textX, infoY);
    if (companyAddress && companyCity) doc.text("|", pipeX, infoY);
    if (companyCity) doc.text(companyCity, companyAddress ? rightTextX : textX, infoY);
    infoY += 5;
  }
  if (phoneStr || companyEmail) {
    if (phoneStr) doc.text(phoneStr, textX, infoY);
    if (phoneStr && companyEmail) doc.text("|", pipeX, infoY);
    if (companyEmail) doc.text(companyEmail, phoneStr ? rightTextX : textX, infoY);
    infoY += 5;
  }
  y = Math.max(y + logoSize, infoY) + 6;

  const labeled = (label: string, value: string, x: number, yy: number) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(0, 0, 0);
    doc.text(label, x, yy);
    doc.setFont("helvetica", "normal");
    doc.text(value || "", x + doc.getTextWidth(label), yy);
  };

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  const numberLine = `JOB : ${number}`;
  let blockW = doc.getTextWidth(numberLine);
  doc.setFontSize(10);
  blockW = Math.max(blockW, doc.getTextWidth("SERVICE DETAILS"));
  const pairW = (label: string, value: string) => {
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    const labelWidth = doc.getTextWidth(label);
    doc.setFont("helvetica", "normal");
    return labelWidth + doc.getTextWidth(value || "");
  };
  blockW = Math.max(
    blockW,
    pairW("Date : ", dateLabel),
    startTime ? pairW("Start Time : ", startTime) : 0,
    endTime ? pairW("End Time : ", endTime) : 0,
    pairW("Type of service : ", serviceType),
    pairW("Frequency : ", frequency),
  );
  const rightX = Math.max(margin + 78, pageWidth - margin - blockW);
  let leftY = y;
  let rightY = y;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("CUSTOMER INFORMATION", margin, leftY);
  leftY += 7;
  labeled("Name : ", String(job.client_name || ""), margin, leftY); leftY += 5;
  labeled("Phone : ", formatSheetPhone(String(job.client_phone || "")), margin, leftY); leftY += 5;
  labeled("Email : ", String(job.client_email || ""), margin, leftY); leftY += 5;
  labeled("Address : ", [job.property_street, job.property_apt].filter(Boolean).join(" "), margin, leftY); leftY += 5;
  const clientCity = [job.property_city, [job.property_state, job.property_zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  if (clientCity) {
    doc.setFont("helvetica", "normal");
    doc.text(String(clientCity), margin, leftY);
    leftY += 5;
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(numberLine, rightX, rightY);
  rightY += 7;
  doc.setFontSize(10);
  doc.text("SERVICE DETAILS", rightX, rightY);
  rightY += 6;
  labeled("Date : ", dateLabel === "N/A" ? "" : dateLabel, rightX, rightY); rightY += 5;
  if (startTime) { labeled("Start Time : ", startTime, rightX, rightY); rightY += 5; }
  if (endTime) { labeled("End Time : ", endTime, rightX, rightY); rightY += 5; }
  labeled("Type of service : ", serviceType, rightX, rightY); rightY += 5;
  labeled("Frequency : ", frequency, rightX, rightY); rightY += 5;
  y = Math.max(leftY, rightY) + 4;

  const cols = [14, 78, 28, 22, contentWidth - 14 - 78 - 28 - 22];
  const headers = ["ITEM", "DESCRIPTION", "PRICE", "QTY", "SUBTOTAL"];
  const rowH = 7;
  const drawHeader = () => {
    if (y > pageHeight - 40) { doc.addPage(); y = margin; }
    doc.setFillColor(navy[0], navy[1], navy[2]);
    doc.rect(margin, y, contentWidth, rowH, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    let x = margin;
    headers.forEach((label, i) => {
      const tx = i === 0 ? x + 2 : x + cols[i] / 2;
      doc.text(label, tx, y + 4.6, { align: i === 0 ? "left" : "center" });
      x += cols[i];
    });
    y += rowH;
  };
  drawHeader();
  doc.setTextColor(0, 0, 0);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  lines.forEach((line, index) => {
    if (y > pageHeight - 28) {
      doc.addPage();
      y = margin;
      drawHeader();
      doc.setTextColor(0, 0, 0);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
    }
    doc.setDrawColor(180, 180, 180);
    doc.setLineWidth(0.1);
    const cells = [
      String(index + 1),
      line.description,
      line.price == null ? "---" : money(line.price),
      String(line.qty),
      line.amount == null ? "" : money(line.amount),
    ];
    let x = margin;
    cells.forEach((cell, i) => {
      doc.rect(x, y, cols[i], rowH);
      const tx = i >= 2 ? x + cols[i] / 2 : x + 2;
      const shown = cell.length > 42 ? `${cell.slice(0, 41)}…` : cell;
      doc.text(shown, tx, y + 4.6, { align: i >= 2 ? "center" : "left" });
      x += cols[i];
    });
    y += rowH;
  });

  y += 16;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  const amountRight = pageWidth - margin - 1.5;
  const amountColW = 22;
  const labelGap = 3;
  const totalLabels = ["Subtotal :", "Discount :", "Tax :", "Deposit :", "Pending :", "Total :"];
  const labelW = Math.max(...totalLabels.map((label) => doc.getTextWidth(label)));
  const labelX = amountRight - amountColW - labelGap - labelW;
  const drawTotalRow = (label: string, value: string) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(0, 0, 0);
    doc.text(label, labelX, y);
    doc.setFont("helvetica", "normal");
    doc.text(value, amountRight, y, { align: "right" });
    y += 6;
  };
  drawTotalRow("Subtotal :", money(subtotal));
  drawTotalRow("Discount :", money(discount));
  drawTotalRow("Tax :", money(tax));
  y += 1;
  const totalH = 8;
  const barLeft = labelX - 1.5;
  const valueBoxLeft = amountRight - amountColW;
  doc.setFillColor(navy[0], navy[1], navy[2]);
  doc.rect(barLeft, y - 5, valueBoxLeft - barLeft, totalH, "F");
  doc.setDrawColor(180, 180, 180);
  doc.setLineWidth(0.1);
  doc.rect(valueBoxLeft, y - 5, pageWidth - margin - valueBoxLeft, totalH);
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.text("Total :", labelX, y);
  doc.setTextColor(0, 0, 0);
  doc.setFont("helvetica", "normal");
  doc.text(money(total), amountRight, y, { align: "right" });
  y += 10;
  drawTotalRow("Deposit :", money(deposit));
  drawTotalRow("Pending :", money(pending));

  let footerY = pageHeight - 12;
  if (y > footerY - 8) footerY = y + 10;
  if (footerY > pageHeight - 8) {
    doc.addPage();
    footerY = pageHeight - 12;
  }
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(navy[0], navy[1], navy[2]);
  const brand = "Service Provide By Thunder Pro Inc";
  const site = "www.thunderpro.co";
  const gap = 10;
  const brandW = doc.getTextWidth(brand);
  const footerX = (pageWidth - brandW - gap - doc.getTextWidth(site)) / 2;
  doc.text(brand, footerX, footerY);
  doc.textWithLink(site, footerX + brandW + gap, footerY, { url: "https://www.thunderpro.co" });

  return new Uint8Array(doc.output("arraybuffer"));
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const token = new URL(req.url).searchParams.get("token")?.trim() || "";
    if (!token || !UUID.test(token)) {
      return new Response(JSON.stringify({ error: "Missing token parameter" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { data: job, error } = await supabase
      .from("jobs")
      .select("*")
      .eq("id", token)
      .maybeSingle();

    if (error || !job) {
      return new Response(JSON.stringify({ error: "Job not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("*")
      .eq("user_id", job.user_id)
      .maybeSingle();

    const pdfBytes = await generateJobPDF(job, profile || {});
    const filename = `Job_${String(job.id).substring(0, 8).toUpperCase()}.pdf`;
    return new Response(pdfBytes, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${filename}"`,
        ...corsHeaders,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to generate job PDF";
    console.error("download-job-pdf", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
});
