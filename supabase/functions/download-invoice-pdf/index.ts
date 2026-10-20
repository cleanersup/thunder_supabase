import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.76.1';
import * as Sentry from "npm:@sentry/deno";
import { formatDateOnlyLong } from "../_shared/formatDateOnly.ts";
import { calculateInvoiceTotals } from "../_shared/invoiceCalculations.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Sentry.init({
  dsn: "https://ce035a76b6157a602d88c53eab6570e4@o4509804047958016.ingest.us.sentry.io/4510552540971008",
  environment: Deno.env.get("SUPABASE_URL")?.includes("staging") ? "staging" : "production",
  tracesSampleRate: 0.1,
});

const money = (n: number) =>
  `$${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function formatSheetPhone(raw: string): string {
  if (!raw?.trim()) return '';
  const digits = raw.replace(/\D/g, '');
  const n = digits.length > 10 ? digits.slice(-10) : digits;
  if (n.length !== 10) return raw.trim();
  return `(${n.slice(0, 3)})${n.slice(3, 6)}-${n.slice(6)}`;
}

function taxLabel(rate: number): string {
  const n = Number(rate) || 0;
  const text = Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
  return `Tax ${text} % :`;
}

async function loadLogoForPdf(src: string | null | undefined): Promise<{ data: string; format: string } | null> {
  if (!src) return null;
  if (src.startsWith('data:image/png')) return { data: src, format: 'PNG' };
  if (src.startsWith('data:image/jpeg') || src.startsWith('data:image/jpg')) return { data: src, format: 'JPEG' };
  if (!src.startsWith('http')) return null;
  try {
    const res = await fetch(src);
    if (!res.ok) return null;
    const type = (res.headers.get('content-type') || '').toLowerCase();
    const format = type.includes('png') ? 'PNG' : type.includes('jpeg') || type.includes('jpg') ? 'JPEG' : null;
    if (!format) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return { data: `data:${format === 'PNG' ? 'image/png' : 'image/jpeg'};base64,${btoa(binary)}`, format };
  } catch {
    return null;
  }
}

async function generateInvoicePDF(invoice: any, profile: any): Promise<Uint8Array> {
  const jsPDF = (await import('https://esm.sh/jspdf@2.5.1')).default;
  const doc = new jsPDF({ unit: 'mm', format: 'letter' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 12;
  const contentWidth = pageWidth - margin * 2;
  const navy = [18, 52, 99];
  const totals = calculateInvoiceTotals(invoice);
  const formatDate = (dateStr: string) => formatDateOnlyLong(dateStr);
  const invoiceDate = formatDate(invoice.invoice_date);
  const dueDate = formatDate(invoice.due_date);
  const number = invoice.invoice_number || '';
  const title = invoice.invoice_name || '';

  let y = margin;
  doc.setFillColor(navy[0], navy[1], navy[2]);
  doc.rect(margin, y, contentWidth, 10, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('INVOICE', pageWidth / 2, y + 6.6, { align: 'center' });
  y += 16;

  const logoSize = 22;
  const logo = await loadLogoForPdf(profile?.company_logo);
  if (logo) {
    try { doc.addImage(logo.data, logo.format, margin, y, logoSize, logoSize); } catch { /* ignore */ }
  }
  const companyName = profile?.company_name || '';
  const companyStreet = [profile?.company_address, profile?.company_apt_suite].filter(Boolean).join(' ');
  const locality = [profile?.company_city, profile?.company_state, profile?.company_zip].filter(Boolean).join(' , ');
  const phoneStr = formatSheetPhone(profile?.company_phone || '');
  const emailStr = profile?.company_email || '';
  const textX = margin + (logo ? logoSize + 4 : 0);
  doc.setTextColor(0, 0, 0);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(companyName, textX, y + 6);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  const leftColW = Math.max(doc.getTextWidth(companyStreet), doc.getTextWidth(phoneStr));
  const pipeX = textX + leftColW + 3;
  const rightTextX = pipeX + doc.getTextWidth('|') + 3;
  let infoY = y + 12;
  if (companyStreet || locality) {
    if (companyStreet) doc.text(companyStreet, textX, infoY);
    if (companyStreet && locality) doc.text('|', pipeX, infoY);
    if (locality) doc.text(locality, companyStreet ? rightTextX : textX, infoY);
    infoY += 5;
  }
  if (phoneStr || emailStr) {
    if (phoneStr) doc.text(phoneStr, textX, infoY);
    if (phoneStr && emailStr) doc.text('|', pipeX, infoY);
    if (emailStr) doc.text(emailStr, phoneStr ? rightTextX : textX, infoY);
    infoY += 5;
  }
  y = Math.max(y + logoSize, infoY) + 6;

  const labeled = (label: string, value: string, x: number, yy: number, maxW: number) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(0, 0, 0);
    doc.text(label, x, yy);
    const labelW = doc.getTextWidth(label);
    doc.setFont('helvetica', 'normal');
    const lines = doc.splitTextToSize(value || '', Math.max(20, maxW - labelW));
    doc.text(lines[0] ?? '', x + labelW, yy);
    return lines.slice(1);
  };

  const taxText = taxLabel(totals.taxRate);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  const numberLine = `INVOICE : ${number}`;
  let blockW = doc.getTextWidth(numberLine);
  const pairW = (label: string, value: string) => {
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    const labelWidth = doc.getTextWidth(label);
    doc.setFont('helvetica', 'normal');
    return labelWidth + doc.getTextWidth(value || '');
  };
  blockW = Math.max(
    blockW,
    pairW('Date : ', invoiceDate),
    pairW('Issue Date : ', invoiceDate),
    pairW('Due Date : ', dueDate),
    title ? pairW('Title : ', title) : 0,
  );
  const rightX = Math.max(margin + 78, pageWidth - margin - blockW);
  const colW = pageWidth - margin - rightX;
  const customerColW = Math.max(40, rightX - margin - 4);
  let leftY = y;
  let rightY = y;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('CUSTOMER INFORMATION', margin, leftY);
  leftY += 7;
  const street = [invoice.address, invoice.apt].filter(Boolean).join(' ');
  const clientCity = [invoice.city, [invoice.state, invoice.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  labeled('Name : ', invoice.client_name || '', margin, leftY, customerColW); leftY += 5;
  labeled('Phone : ', formatSheetPhone(invoice.phone || ''), margin, leftY, customerColW); leftY += 5;
  labeled('Email : ', invoice.email || '', margin, leftY, customerColW); leftY += 5;
  labeled('Address : ', street, margin, leftY, customerColW); leftY += 5;
  if (clientCity) { doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.text(clientCity, margin, leftY); leftY += 5; }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(numberLine, rightX, rightY);
  rightY += 7;
  labeled('Date : ', invoiceDate, rightX, rightY, colW); rightY += 5;
  labeled('Issue Date : ', invoiceDate, rightX, rightY, colW); rightY += 5;
  labeled('Due Date : ', dueDate, rightX, rightY, colW); rightY += 5;
  if (title) {
    const extra = labeled('Title : ', title, rightX, rightY, colW);
    rightY += 5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    extra.forEach((line: string) => { doc.text(line, rightX, rightY); rightY += 5; });
  }

  y = Math.max(leftY, rightY) + 4;
  const rawItems = Array.isArray(invoice.line_items) ? invoice.line_items : [];
  const lines = rawItems.length > 0
    ? rawItems.map((item: any) => ({
      description: item?.description || '',
      price: Number(item?.price) || 0,
      qty: Number(item?.qty ?? item?.quantity ?? 1) || 1,
      total: Number(item?.total) || 0,
    }))
    : [{ description: title || 'Services', price: totals.subtotal, qty: 1, total: totals.subtotal }];

  const cols = [14, 78, 28, 22, contentWidth - 14 - 78 - 28 - 22];
  const headers = ['ITEM', 'DESCRIPTION', 'PRICE', 'QTY', 'SUBTOTAL'];
  const rowH = 7;
  const drawHeader = () => {
    if (y > pageHeight - 40) { doc.addPage(); y = margin; }
    doc.setFillColor(navy[0], navy[1], navy[2]);
    doc.rect(margin, y, contentWidth, rowH, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    let x = margin;
    headers.forEach((label, i) => {
      const tx = i === 0 ? x + 2 : x + cols[i] / 2;
      doc.text(label, tx, y + 4.6, { align: i === 0 ? 'left' : 'center' });
      x += cols[i];
    });
    y += rowH;
  };
  drawHeader();
  doc.setTextColor(0, 0, 0);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  lines.forEach((line: { description: string; price: number; qty: number; total: number }, index: number) => {
    if (y > pageHeight - 28) {
      doc.addPage(); y = margin; drawHeader();
      doc.setTextColor(0, 0, 0); doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
    }
    doc.setDrawColor(180, 180, 180);
    doc.setLineWidth(0.1);
    const cells = [String(index + 1), line.description, money(line.price), String(line.qty), money(line.total)];
    let x = margin;
    cells.forEach((cell, i) => {
      doc.rect(x, y, cols[i], rowH);
      const tx = i >= 2 ? x + cols[i] / 2 : x + 2;
      doc.text(cell, tx, y + 4.6, { align: i >= 2 ? 'center' : 'left' });
      x += cols[i];
    });
    y += rowH;
  });

  y += 16;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  const amountRight = pageWidth - margin - 1.5;
  const amountColW = 22;
  const labelGap = 3;
  const labelW = Math.max(...['Subtotal :', 'Discount :', taxText, 'Total :'].map((label) => doc.getTextWidth(label)));
  const labelX = amountRight - amountColW - labelGap - labelW;
  const drawTotalRow = (label: string, value: string) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(0, 0, 0);
    doc.text(label, labelX, y);
    doc.setFont('helvetica', 'normal');
    doc.text(value, amountRight, y, { align: 'right' });
    y += 6;
  };
  drawTotalRow('Subtotal :', money(totals.subtotal));
  drawTotalRow('Discount :', money(totals.discountAmount));
  drawTotalRow(taxText, money(totals.taxAmount));
  y += 1;
  const totalH = 8;
  const barLeft = labelX - 1.5;
  const valueBoxLeft = amountRight - amountColW;
  doc.setFillColor(navy[0], navy[1], navy[2]);
  doc.rect(barLeft, y - 5, valueBoxLeft - barLeft, totalH, 'F');
  doc.setDrawColor(180, 180, 180);
  doc.setLineWidth(0.1);
  doc.rect(valueBoxLeft, y - 5, pageWidth - margin - valueBoxLeft, totalH);
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.text('Total :', labelX, y);
  doc.setTextColor(0, 0, 0);
  doc.setFont('helvetica', 'normal');
  doc.text(money(totals.total), amountRight, y, { align: 'right' });
  y += 14;

  const notes = String(invoice.notes || '').trim();
  if (notes) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(0, 0, 0);
    const notesLabel = 'Notes : ';
    doc.text(notesLabel, margin, y);
    const notesX = margin + doc.getTextWidth(notesLabel);
    doc.setFont('helvetica', 'normal');
    const notesLines = doc.splitTextToSize(notes, pageWidth - margin - notesX);
    doc.text(notesLines[0] ?? '', notesX, y);
    y += 5;
    if (notesLines.length > 1) {
      const rest = doc.splitTextToSize(notesLines.slice(1).join(' '), contentWidth);
      rest.forEach((line: string) => { doc.text(line, margin, y); y += 5; });
    }
  }

  let footerY = pageHeight - 12;
  if (y > footerY - 8) footerY = y + 10;
  if (footerY > pageHeight - 8) {
    doc.addPage();
    footerY = pageHeight - 12;
  }
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(navy[0], navy[1], navy[2]);
  const brand = 'Service Provide By Thunder Pro Inc';
  const site = 'www.thunderpro.co';
  const gap = 10;
  const brandW = doc.getTextWidth(brand);
  const footerX = (pageWidth - brandW - gap - doc.getTextWidth(site)) / 2;
  doc.text(brand, footerX, footerY);
  doc.textWithLink(site, footerX + brandW + gap, footerY, { url: 'https://www.thunderpro.co' });

  return new Uint8Array(doc.output('arraybuffer'));
}

serve(async (req: Request): Promise<Response> => {
  return await Sentry.withScope(async (scope) => {
    Sentry.setTag("function", "download-invoice-pdf");

    if (req.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      const url = new URL(req.url);
      const token = (url.searchParams.get('token') || url.searchParams.get('id') || '').trim();

      if (!token) {
        return new Response(
          JSON.stringify({ error: 'Missing invoice ID parameter' }),
          { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
        );
      }

      const supabase = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
      );

      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token);
      let invoice = null;
      let invoiceError = null;

      if (isUuid) {
        const byId = await supabase.from('invoices').select('*').eq('id', token).maybeSingle();
        invoice = byId.data;
        invoiceError = byId.error;
      }
      if (!invoice && !invoiceError) {
        const byToken = await supabase.from('invoices').select('*').eq('payment_token', token).maybeSingle();
        invoice = byToken.data;
        invoiceError = byToken.error;
      }

      if (invoiceError || !invoice) {
        return new Response(
          JSON.stringify({ error: 'Invoice not found' }),
          { status: 404, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
        );
      }

      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('user_id', invoice.user_id)
        .maybeSingle();

      if (profileError) {
        console.error('Error fetching profile:', profileError);
      }

      const pdfBytes = await generateInvoicePDF(invoice, profile || {});
      const filename = `Invoice_${invoice.invoice_number}.pdf`;

      return new Response(pdfBytes, {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `inline; filename="${filename}"`,
          ...corsHeaders,
        },
      });
    } catch (error: any) {
      Sentry.captureException(error);
      console.error('Error generating invoice PDF:', error);
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
      );
    }
  });
});
