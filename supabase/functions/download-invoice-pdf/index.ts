import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.76.1';
import * as Sentry from "npm:@sentry/deno";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Sentry.init({
  dsn: "https://ce035a76b6157a602d88c53eab6570e4@o4509804047958016.ingest.us.sentry.io/4510552540971008",
  environment: Deno.env.get("SUPABASE_URL")?.includes("staging") ? "staging" : "production",
  tracesSampleRate: 0.1,
});

// Helper to format currency
const formatCurrency = (value: number): string => {
  return value.toFixed(2);
};

// Generate PDF using jsPDF
// This function creates a PDF matching the email design exactly (without buttons)
async function generateInvoicePDF(invoice: any, profile: any): Promise<Uint8Array> {
  // Import jsPDF dynamically for Deno Edge Functions
  const jsPDF = (await import('https://esm.sh/jspdf@2.5.1')).default;

  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 20;
  let yPosition = 0;

  // Colors matching email design
  const darkBlue = [30, 58, 138]; // #1e3a8a
  const lightGreen = [240, 253, 244]; // #f0fdf4
  const darkGrey = [51, 51, 51]; // #333333
  const lightGrey = [249, 250, 251]; // #f9fafb
  const borderGrey = [229, 231, 235]; // #e5e7eb

  // Helper to format dates like email
  const formatDate = (dateStr: string): string => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  };

  // ===== HEADER (Dark Blue Banner) =====
  doc.setFillColor(darkBlue[0], darkBlue[1], darkBlue[2]);
  doc.rect(0, yPosition, pageWidth, 30, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(22);
  doc.setFont('helvetica', 'bold');
  const companyName = profile?.company_name || 'Company Name';
  doc.text(companyName, pageWidth / 2, yPosition + 12, { align: 'center' });
  doc.setFontSize(14);
  doc.setFont('helvetica', 'normal');
  doc.text('Professional Cleaning Invoice', pageWidth / 2, yPosition + 22, { align: 'center' });
  yPosition = 40;

  // ===== CONTENT AREA =====
  const contentStartY = yPosition;
  yPosition += 20;

  // Client Information Section
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(darkBlue[0], darkBlue[1], darkBlue[2]);
  doc.text('Client Information', margin, yPosition);
  yPosition += 8;
  // Underline
  doc.setDrawColor(darkBlue[0], darkBlue[1], darkBlue[2]);
  doc.setLineWidth(2);
  doc.line(margin, yPosition, pageWidth - margin, yPosition);
  yPosition += 12;

  doc.setFontSize(13);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(darkGrey[0], darkGrey[1], darkGrey[2]);
  doc.setFont('helvetica', 'bold');
  doc.text('Name:', margin, yPosition);
  doc.setFont('helvetica', 'normal');
  doc.text(invoice.client_name, margin + 30, yPosition);
  yPosition += 6;

  doc.setFont('helvetica', 'bold');
  doc.text('Email:', margin, yPosition);
  doc.setFont('helvetica', 'normal');
  doc.text(invoice.email, margin + 30, yPosition);
  yPosition += 6;

  doc.setFont('helvetica', 'bold');
  doc.text('Phone:', margin, yPosition);
  doc.setFont('helvetica', 'normal');
  doc.text(invoice.phone, margin + 30, yPosition);
  yPosition += 6;

  doc.setFont('helvetica', 'bold');
  doc.text('Address:', margin, yPosition);
  doc.setFont('helvetica', 'normal');
  const address = `${invoice.address}${invoice.apt ? `, ${invoice.apt}` : ''}, ${invoice.city}, ${invoice.state} ${invoice.zip}`;
  doc.text(address, margin + 30, yPosition);
  yPosition += 20;

  // Invoice Details Section
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(darkBlue[0], darkBlue[1], darkBlue[2]);
  doc.text('Invoice Details', margin, yPosition);
  yPosition += 8;
  // Underline
  doc.line(margin, yPosition, pageWidth - margin, yPosition);
  yPosition += 12;

  doc.setFontSize(13);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(darkGrey[0], darkGrey[1], darkGrey[2]);
  doc.setFont('helvetica', 'bold');
  doc.text('Invoice Number:', margin, yPosition);
  doc.setFont('helvetica', 'normal');
  doc.text(invoice.invoice_number, margin + 50, yPosition);
  yPosition += 6;

  doc.setFont('helvetica', 'bold');
  doc.text('Invoice Date:', margin, yPosition);
  doc.setFont('helvetica', 'normal');
  doc.text(formatDate(invoice.invoice_date), margin + 50, yPosition);
  yPosition += 6;

  doc.setFont('helvetica', 'bold');
  doc.text('Due Date:', margin, yPosition);
  doc.setFont('helvetica', 'normal');
  doc.text(formatDate(invoice.due_date), margin + 50, yPosition);
  yPosition += 6;

  doc.setFont('helvetica', 'bold');
  doc.text('Service Type:', margin, yPosition);
  doc.setFont('helvetica', 'normal');
  doc.text(invoice.service_type || '-', margin + 50, yPosition);
  yPosition += 20;

  // Line Items Section
  if (invoice.line_items && invoice.line_items.length > 0) {
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(darkBlue[0], darkBlue[1], darkBlue[2]);
    doc.text('Line Items', margin, yPosition);
    yPosition += 8;
    // Underline
    doc.line(margin, yPosition, pageWidth - margin, yPosition);
    yPosition += 12;

    // Table Header
    const headerRowHeight = 10;
    const headerY = yPosition;
    doc.setFillColor(lightGrey[0], lightGrey[1], lightGrey[2]);
    doc.rect(margin, headerY, pageWidth - (margin * 2), headerRowHeight, 'F');

    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(darkGrey[0], darkGrey[1], darkGrey[2]);
    // Center text vertically in header row
    doc.text('Description', margin + 5, headerY + 6);
    doc.text('Price', pageWidth - margin - 100, headerY + 6, { align: 'center' });
    doc.text('Qty', pageWidth - margin - 60, headerY + 6, { align: 'center' });
    doc.text('Total', pageWidth - margin - 5, headerY + 6, { align: 'right' });

    // Table border
    doc.setDrawColor(borderGrey[0], borderGrey[1], borderGrey[2]);
    doc.setLineWidth(1);
    doc.rect(margin, headerY, pageWidth - (margin * 2), headerRowHeight);
    yPosition = headerY + headerRowHeight;

    // Table rows
    invoice.line_items.forEach((item: any, index: number) => {
      if (yPosition > pageHeight - 40) {
        doc.addPage();
        yPosition = margin + 10;
      }

      const rowHeight = 10;
      const rowY = yPosition;

      // Alternate row background
      if (index % 2 === 1) {
        doc.setFillColor(lightGrey[0], lightGrey[1], lightGrey[2]);
        doc.rect(margin, rowY, pageWidth - (margin * 2), rowHeight, 'F');
      }

      doc.setFontSize(13);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(darkGrey[0], darkGrey[1], darkGrey[2]);
      // Center text vertically in row (rowY + rowHeight/2 + text offset)
      doc.text(item.description || '-', margin + 5, rowY + 6);
      doc.text(`$${formatCurrency(parseFloat(item.price) || 0)}`, pageWidth - margin - 100, rowY + 6, { align: 'center' });
      doc.text(`${item.qty || 1}`, pageWidth - margin - 60, rowY + 6, { align: 'center' });
      doc.setFont('helvetica', 'bold');
      doc.text(`$${formatCurrency(item.total || 0)}`, pageWidth - margin - 5, rowY + 6, { align: 'right' });

      // Row border (bottom of row)
      doc.setDrawColor(borderGrey[0], borderGrey[1], borderGrey[2]);
      doc.line(margin, rowY + rowHeight, pageWidth - margin, rowY + rowHeight);
      yPosition += rowHeight;
    });

    yPosition += 10;
  }

  // Amount Due Section
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(darkBlue[0], darkBlue[1], darkBlue[2]);
  doc.text('Amount Due', margin, yPosition);
  yPosition += 15;

  // Light green box for total
  doc.setFillColor(lightGreen[0], lightGreen[1], lightGreen[2]);
  doc.rect(margin, yPosition - 8, pageWidth - (margin * 2), 20, 'F');

  doc.setFontSize(20);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(darkBlue[0], darkBlue[1], darkBlue[2]);
  doc.text('Total Amount Due:', margin + 10, yPosition + 4);
  doc.text(`$${formatCurrency(invoice.total)}`, pageWidth - margin - 10, yPosition + 4, { align: 'right' });
  yPosition += 25;

  // ===== FOOTER (Dark Blue Banner) =====
  const footerY = pageHeight - 25;
  doc.setFillColor(darkBlue[0], darkBlue[1], darkBlue[2]);
  doc.rect(0, footerY, pageWidth, 25, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(12);
  doc.setFont('helvetica', 'normal');
  doc.text('Service provided by', pageWidth / 2, footerY + 8, { align: 'center' });
  doc.text('© 2024 Thunder Pro Inc. | www.thunderpro.co', pageWidth / 2, footerY + 18, { align: 'center' });

  // Convert to Uint8Array for response
  const pdfOutput = doc.output('arraybuffer');
  return new Uint8Array(pdfOutput);
}

serve(async (req: Request): Promise<Response> => {
  return await Sentry.withScope(async (scope) => {
    Sentry.setTag("function", "download-invoice-pdf");

    if (req.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // Get invoice ID from URL query parameter
      const url = new URL(req.url);
      const invoiceId = url.searchParams.get('id');

      if (!invoiceId) {
        return new Response(
          JSON.stringify({ error: 'Missing invoice ID parameter' }),
          { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
        );
      }

      // Create Supabase client with service role key
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
      );

      // Fetch invoice
      const { data: invoice, error: invoiceError } = await supabase
        .from('invoices')
        .select('*')
        .eq('id', invoiceId)
        .maybeSingle();

      if (invoiceError || !invoice) {
        return new Response(
          JSON.stringify({ error: 'Invoice not found' }),
          { status: 404, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
        );
      }

      // Fetch profile data
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('user_id', invoice.user_id)
        .maybeSingle();

      if (profileError) {
        console.error('Error fetching profile:', profileError);
      }

      // Generate PDF
      const pdfBytes = await generateInvoicePDF(invoice, profile || {});

      // Return PDF as download
      return new Response(pdfBytes, {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="Invoice_${invoice.invoice_number}.pdf"`,
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
