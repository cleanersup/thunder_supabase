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

// Helper to translate Spanish values to English
const translateToEnglish = (value: string | number | boolean): string => {
  if (typeof value !== 'string') return String(value);
  const translations: Record<string, string> = {
    'bajo': 'low', 'medio': 'medium', 'alto': 'high',
    'diurno': 'day shift', 'nocturno': 'night shift', 'madrugada': 'early morning',
    'limpio': 'clean', 'sucio': 'dirty', 'muy sucio': 'very dirty', 'muy-sucio': 'very dirty',
    'bien-mantenido': 'well-maintained', 'bien mantenido': 'well-maintained',
    'restaurante': 'restaurant', 'oficina': 'office', 'tienda': 'store',
    'una vez': 'one-time', 'semanal': 'weekly', 'mensual': 'monthly',
    'ventanas': 'windows', 'campanas': 'hoods', 'refrigeradores': 'refrigerators',
  };
  if (value.includes(',')) {
    return value.split(',').map(item => translations[item.trim().toLowerCase()] || item.trim()).join(', ');
  }
  return translations[value.toLowerCase()] || value;
};

// Generate Commercial Proposal PDF
async function generateCommercialProposalPDF(estimate: any, profile: any): Promise<Uint8Array> {
  // Import jsPDF dynamically for Deno Edge Functions
  const jsPDF = (await import('https://esm.sh/jspdf@2.5.1')).default;

  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 20;
  const contentWidth = pageWidth - (margin * 2);
  let yPosition = margin;

  // Helper function to add text with word wrap
  const addText = (text: string, fontSize: number = 10, isBold: boolean = false, indent: number = 0) => {
    doc.setFontSize(fontSize);
    doc.setFont('helvetica', isBold ? 'bold' : 'normal');
    const lines = doc.splitTextToSize(text, contentWidth - indent);

    lines.forEach((line: string) => {
      if (yPosition > pageHeight - margin) {
        doc.addPage();
        yPosition = margin;
      }
      doc.text(line, margin + indent, yPosition);
      yPosition += fontSize * 0.5;
    });
  };

  const addLine = () => {
    if (yPosition > pageHeight - margin) {
      doc.addPage();
      yPosition = margin;
    }
    doc.line(margin, yPosition, pageWidth - margin, yPosition);
    yPosition += 5;
  };

  const addSpace = (space: number = 5) => {
    yPosition += space;
  };

  // Extract data from estimate
  const mainData = estimate.main_data || {};
  const additionalData = estimate.additional_data || {};

  // Helper to safely get value
  const getValue = (value: any): string => {
    if (value === null || value === undefined || value === '') return '';
    return String(value);
  };

  // Format extra services array
  const formatExtraServices = (extraServices: any): string[] => {
    if (!extraServices) return [];
    if (Array.isArray(extraServices)) {
      return extraServices.filter(s => s);
    }
    if (typeof extraServices === 'object') {
      return Object.keys(extraServices).filter(key => extraServices[key]);
    }
    return [];
  };

  const companyName = profile?.company_name || estimate.company_name || 'Thunder Pro Inc.';
  const companyPhone = profile?.company_phone || estimate.company_phone || '';
  const companyEmail = profile?.company_email || estimate.company_email || '';
  const companyAddress = profile?.company_address || '';
  const clientName = estimate.client_name;
  const clientEmail = estimate.email;
  const clientPhone = estimate.phone;
  const clientAddress = `${estimate.address}${estimate.apt ? `, ${estimate.apt}` : ''}, ${estimate.city}, ${estimate.state} ${estimate.zip}`;
  const propertyType = getValue(mainData.propertyType);
  const propertySize = getValue(mainData.propertySize);
  const serviceType = getValue(mainData.serviceType);
  const serviceSchedule = getValue(additionalData.serviceSchedule);
  const greaseLevel = getValue(mainData.greaseLevel || additionalData.greaseLevel);
  const restaurantCondition = getValue(mainData.restaurantCondition || additionalData.restaurantCondition);
  const extraServices = formatExtraServices(additionalData.extraServices);

  // Handle cleaningDuration - can be number or string
  let cleaningDuration = '';
  if (mainData.cleaningDuration !== null && mainData.cleaningDuration !== undefined && mainData.cleaningDuration !== '') {
    cleaningDuration = String(mainData.cleaningDuration);
  }

  const startTime = getValue(mainData.startTime);
  const scopeDetails = getValue(estimate.service_scope);
  const finalPrice = (estimate.total || 0).toFixed(2);
  const deposit = (parseFloat(finalPrice) * 0.5).toFixed(2);

  // Page 1 - Cover
  yPosition = pageHeight / 3;
  doc.setFontSize(20);
  doc.setFont('helvetica', 'bold');
  const title1 = 'COMMERCIAL CLEANING SERVICES';
  const title2 = 'PROPOSAL';
  doc.text(title1, pageWidth / 2, yPosition, { align: 'center' });
  yPosition += 10;
  doc.text(title2, pageWidth / 2, yPosition, { align: 'center' });

  // Page 2 - Service Provider & Client Info
  doc.addPage();
  yPosition = margin;

  addText('SERVICE PROVIDER:', 12, true);
  addSpace(3);
  addText(companyName, 10, false, 5);
  addText(companyPhone, 10, false, 5);
  addText(companyEmail, 10, false, 5);
  addSpace(8);

  addText('CLIENT:', 12, true);
  addSpace(3);
  addText(clientName, 10, false, 5);
  addText(clientEmail, 10, false, 5);
  addText(clientPhone, 10, false, 5);
  addText(clientAddress, 10, false, 5);
  addSpace(8);

  addText('SERVICE SPECIFICATIONS:', 12, true);
  addSpace(3);
  if (propertyType) addText(`Property Type: ${translateToEnglish(propertyType)}`, 10, false, 5);
  if (propertySize) addText(`Property Size: ${propertySize} sqft`, 10, false, 5);
  if (serviceType) addText(`Service Type: ${translateToEnglish(serviceType)}`, 10, false, 5);
  if (serviceSchedule) addText(`Service Schedule: ${translateToEnglish(serviceSchedule)}`, 10, false, 5);
  if (greaseLevel) addText(`Grease Level: ${translateToEnglish(greaseLevel)}`, 10, false, 5);
  if (restaurantCondition) addText(`Restaurant Condition: ${translateToEnglish(restaurantCondition)}`, 10, false, 5);
  if (extraServices.length > 0) addText(`Extra Services: ${translateToEnglish(extraServices.join(', '))}`, 10, false, 5);
  if (cleaningDuration) addText(`Cleaning Duration: ${cleaningDuration} hours`, 10, false, 5);
  if (startTime) addText(`Time: ${startTime}`, 10, false, 5);
  if (scopeDetails) addText(`Service Scope: ${scopeDetails}`, 10, false, 5);

  // Page 3 - Contract Terms
  doc.addPage();
  yPosition = margin;

  addText('CONTRACT TERMS', 14, true);
  addLine();
  addSpace(5);

  // Term 1
  addText('1) Price and Payment Terms', 11, true);
  addSpace(3);
  addText(`The total price for the commercial cleaning service described in this agreement is $${finalPrice} USD`, 10);
  addSpace(2);
  addText('Payment shall be divided into two equal installments as follows:', 10);
  addText(`• 50% deposit ($${deposit}) due prior to the start of the cleaning service.`, 10, false, 5);
  addText(`• Remaining 50% ($${deposit}) due immediately upon completion of the cleaning project.`, 10, false, 5);
  addSpace(2);
  addText('The cleaning service cannot begin without receipt of the initial 50% payment.', 10);
  addSpace(2);
  addText('Accepted payment methods include:', 10);
  addText('• Debit or credit card', 10, false, 5);
  addText('• Cash payment', 10, false, 5);
  addText(`• Checks made payable to ${companyName}`, 10, false, 5);
  addSpace(5);

  // Term 2
  addText('2) 50% ADVANCE PAYMENT POLICY', 11, true);
  addSpace(3);
  addText('To initiate this contract and secure the first cleaning appointment, the client is required to make an advance payment of 50% of the first month\'s fee. This initial payment serves as a booking confirmation and is mandatory to activate the contract. Failure to provide the 50% advance will result in the inability to schedule or begin the cleaning services.', 10);
  addSpace(2);
  addText('The remaining balance for the first month will be due according to the agreed payment schedule.', 10);
  addSpace(5);

  // Term 3
  addText('3) Cancellation Policy', 11, true);
  addSpace(3);
  addText(`In the event that the Client (${clientName}), wishes to cancel the services after making the initial deposit, he may do so without any issues.`, 10);
  addSpace(2);
  addText(`${companyName} will retain 15% of the initial deposit as a non-refundable administrative fee. The remaining 85% of the deposit will be returned to the Client.`, 10);
  addSpace(2);
  addText(`All cancellation notices must be submitted in writing, either via email to ${companyEmail} or by certified mail to the company address.`, 10);
  addSpace(5);

  // Continue with remaining terms...
  doc.addPage();
  yPosition = margin;

  // Term 4
  addText('4) No Refund Clause', 11, true);
  addSpace(3);
  addText(`${companyName} maintains a strict no-refund policy. Under no circumstances will refunds be issued for dissatisfaction with the service or for any other reason, once the services have commenced or been completed as described in this Agreement.`, 10);
  addSpace(2);
  addText('By signing this Agreement, the Client acknowledges and agrees to this no-refund policy and waives any right to dispute charges or request reimbursement for services rendered.', 10);
  addSpace(5);

  // Term 5
  addText('5) ACTIONS IN CASE OF NON-PAYMENT', 11, true);
  addSpace(3);
  addText('If the client fails or refuses to make the final payment as stipulated in this contract, our company reserves the right to initiate legal actions. This includes reporting the matter to the appropriate authorities and filing a formal claim with the Small Claims Court at the county level.', 10);
  addSpace(2);
  addText('Such measures will be pursued to recover the outstanding balance, and all related costs may be charged to the client.', 10);
  addSpace(5);

  // Term 6
  addText('6) Non-Compete Clause', 11, true);
  addSpace(3);
  addText('The Client agrees that, for the duration of this Agreement and for a period of twelve (12) months following its termination or completion, they shall not:', 10);
  addText(`1. Directly or indirectly solicit, hire, or attempt to hire any employee, contractor, or subcontractor of ${companyName} who was involved in the performance of services under this Agreement.`, 10, false, 5);
  addText(`2. Engage with or contract any individual or third party using confidential or proprietary information obtained through this Agreement with the intention of replicating or continuing similar services without the involvement of ${companyName}.`, 10, false, 5);
  addSpace(2);
  addText('Violation of this clause will be considered a material breach of the Agreement and may result in legal action, including but not limited to injunctive relief and damages.', 10);
  addSpace(5);

  // Additional terms continue on new pages as needed...
  doc.addPage();
  yPosition = margin;

  const remainingTerms = [
    {
      title: '7) PRODUCTS AND EQUIPMENT',
      content: 'Our company will provide all necessary cleaning products and equipment required to perform the services at the client\'s property. The client is not responsible for supplying any cleaning materials.\n\nIf the client requests that a specific or personal product be used, the company will not be held liable for the effectiveness, results, or any damage that may arise from the use of that product.'
    },
    {
      title: '8) Anti-Harassment and Respect Policy',
      content: `The Client agrees to provide a safe, respectful, and harassment-free work environment for all employees and representatives of ${companyName} throughout the duration of the services.\n\nAny form of harassment, discrimination, verbal abuse, intimidation, or inappropriate behavior by the Client or its staff toward ${companyName} personnel will be considered a serious breach of this Agreement and may result in the immediate suspension or termination of services without refund or liability.\n\n${companyName} reserves the right to remove its staff from the job site at any time if working conditions are deemed unsafe, hostile, or inappropriate.`
    },
    {
      title: '9) INSURANCE COVERAGE',
      content: 'To ensure a high standard of service and provide peace of mind to our clients, our company maintains active insurance coverage that protects the client\'s property against potential damages or incidents that may occur during the execution of our cleaning services.\n\nProof of insurance can be provided upon request.'
    }
  ];

  remainingTerms.forEach(term => {
    addText(term.title, 11, true);
    addSpace(3);
    addText(term.content, 10);
    addSpace(5);
  });

  // Final page - Signatures
  doc.addPage();
  yPosition = margin;

  addText('10) AGREEMENT EXECUTION', 11, true);
  addSpace(10);

  // Two column layout for signatures
  const colWidth = contentWidth / 2 - 5;

  // Service Provider column
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('SERVICE PROVIDER:', margin, yPosition);
  yPosition += 7;

  doc.setFont('helvetica', 'normal');
  doc.text(companyName, margin, yPosition);
  yPosition += 5;
  doc.text(companyPhone, margin, yPosition);
  yPosition += 5;
  doc.text(companyEmail, margin, yPosition);
  yPosition += 15;

  doc.line(margin, yPosition, margin + colWidth, yPosition);
  yPosition += 5;
  doc.setFontSize(8);
  doc.text('Signature', margin, yPosition);
  yPosition += 10;

  doc.line(margin, yPosition, margin + colWidth, yPosition);
  yPosition += 5;
  doc.text('Date', margin, yPosition);

  // Client column
  yPosition = margin + 18;
  const clientX = pageWidth / 2 + 5;

  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('CLIENT:', clientX, yPosition);
  yPosition += 7;

  doc.setFont('helvetica', 'normal');
  doc.text(clientName, clientX, yPosition);
  yPosition += 5;
  doc.text(clientPhone, clientX, yPosition);
  yPosition += 5;
  doc.text(clientEmail, clientX, yPosition);
  yPosition += 15;

  doc.line(clientX, yPosition, clientX + colWidth, yPosition);
  yPosition += 5;
  doc.setFontSize(8);
  doc.text('Signature', clientX, yPosition);
  yPosition += 10;

  doc.line(clientX, yPosition, clientX + colWidth, yPosition);
  yPosition += 5;
  doc.text('Date', clientX, yPosition);

  // Convert to Uint8Array for response
  const pdfOutput = doc.output('arraybuffer');
  return new Uint8Array(pdfOutput);
}

// Generate PDF using jsPDF
// This function creates a PDF matching the email design exactly (without buttons)
async function generateEstimatePDF(estimate: any, profile: any): Promise<Uint8Array> {
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

  // Helper to format dates like email
  const formatDate = (dateStr: string): string => {
    if (!dateStr) return 'N/A';
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    } catch (error) {
      return dateStr;
    }
  };

  // ===== HEADER (Dark Blue Banner) =====
  doc.setFillColor(darkBlue[0], darkBlue[1], darkBlue[2]);
  doc.rect(0, yPosition, pageWidth, 25, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  const companyName = estimate.company_name || profile?.company_name || 'Company Name';
  doc.text(companyName, pageWidth / 2, yPosition + 10, { align: 'center' });
  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  doc.text('Professional Cleaning Estimate', pageWidth / 2, yPosition + 18, { align: 'center' });
  yPosition = 35;

  // ===== CONTENT AREA =====
  yPosition += 10;

  // Client Information Section
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(darkBlue[0], darkBlue[1], darkBlue[2]);
  doc.text('Client Information', margin, yPosition);
  yPosition += 5;
  // Underline
  doc.setDrawColor(darkBlue[0], darkBlue[1], darkBlue[2]);
  doc.setLineWidth(0.5);
  doc.line(margin, yPosition, pageWidth - margin, yPosition);
  yPosition += 8;

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(darkGrey[0], darkGrey[1], darkGrey[2]);
  doc.setFont('helvetica', 'bold');
  doc.text('Name:', margin, yPosition);
  doc.setFont('helvetica', 'normal');
  doc.text(estimate.client_name, margin + 25, yPosition);
  yPosition += 5;

  doc.setFont('helvetica', 'bold');
  doc.text('Email:', margin, yPosition);
  doc.setFont('helvetica', 'normal');
  doc.text(estimate.email, margin + 25, yPosition);
  yPosition += 5;

  doc.setFont('helvetica', 'bold');
  doc.text('Phone:', margin, yPosition);
  doc.setFont('helvetica', 'normal');
  doc.text(estimate.phone, margin + 25, yPosition);
  yPosition += 5;

  doc.setFont('helvetica', 'bold');
  doc.text('Address:', margin, yPosition);
  doc.setFont('helvetica', 'normal');
  const address = `${estimate.address}${estimate.apt ? `, ${estimate.apt}` : ''}, ${estimate.city}, ${estimate.state} ${estimate.zip}`;
  doc.text(address, margin + 25, yPosition);
  yPosition += 12;

  // Service Details Section
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(darkBlue[0], darkBlue[1], darkBlue[2]);
  doc.text('Service Details', margin, yPosition);
  yPosition += 5;
  // Underline
  doc.setDrawColor(darkBlue[0], darkBlue[1], darkBlue[2]);
  doc.setLineWidth(0.5);
  doc.line(margin, yPosition, pageWidth - margin, yPosition);
  yPosition += 8;

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(darkGrey[0], darkGrey[1], darkGrey[2]);
  doc.setFont('helvetica', 'bold');
  doc.text('Date:', margin, yPosition);
  doc.setFont('helvetica', 'normal');
  doc.text(formatDate(estimate.estimate_date), margin + 25, yPosition);
  yPosition += 5;

  doc.setFont('helvetica', 'bold');
  doc.text('Service Type:', margin, yPosition);
  doc.setFont('helvetica', 'normal');
  const serviceType = `${estimate.service_type}${estimate.service_sub_type ? ` - ${estimate.service_sub_type}` : ''}`;
  doc.text(serviceType, margin + 40, yPosition);
  yPosition += 12;

  // Service Specifications Section (for commercial estimates)
  if (estimate.service_type === 'Commercial') {
    const mainData = estimate.main_data || {};
    const additionalData = estimate.additional_data || {};

    // Helper to safely get value
    const getValue = (value: any): string => {
      if (value === null || value === undefined || value === '') return '';
      return String(value);
    };

    // Format extra services array
    const formatExtraServices = (extraServices: any): string => {
      if (!extraServices) return '';
      if (Array.isArray(extraServices)) {
        return extraServices.filter(s => s).join(', ');
      }
      if (typeof extraServices === 'object') {
        return Object.keys(extraServices).filter(key => extraServices[key]).join(', ');
      }
      return String(extraServices);
    };

    const propertyType = getValue(mainData.propertyType);
    const serviceTypeValue = getValue(mainData.serviceType);
    const extraServices = formatExtraServices(additionalData.extraServices);

    // Handle cleaningDuration - can be number or string
    let cleaningDuration = '';
    if (mainData.cleaningDuration !== null && mainData.cleaningDuration !== undefined && mainData.cleaningDuration !== '') {
      const duration = String(mainData.cleaningDuration);
      cleaningDuration = duration.includes('hours') || duration.includes('hour') ? duration : `${duration} hours`;
    }

    const propertySize = getValue(mainData.propertySize);
    const serviceSchedule = getValue(additionalData.serviceSchedule);
    const startTime = getValue(mainData.startTime);

    // Only show section if there's at least one commercial-specific field
    if (propertyType || serviceTypeValue || extraServices || cleaningDuration || propertySize || serviceSchedule || startTime || estimate.service_scope) {
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(darkBlue[0], darkBlue[1], darkBlue[2]);
      doc.text('Service Specifications', margin, yPosition);
      yPosition += 5;
      // Underline
      doc.setDrawColor(darkBlue[0], darkBlue[1], darkBlue[2]);
      doc.setLineWidth(0.5);
      doc.line(margin, yPosition, pageWidth - margin, yPosition);
      yPosition += 8;

      // Calculate column widths for two-column layout
      const colWidth = (pageWidth - (margin * 2)) / 2;
      const col1X = margin;
      const col2X = margin + colWidth;

      // Build left column
      const leftColumn: Array<{ label: string, value: string }> = [];
      if (propertyType) leftColumn.push({ label: 'Property Type:', value: propertyType });
      if (serviceTypeValue) leftColumn.push({ label: 'Service Type:', value: serviceTypeValue });
      if (extraServices) leftColumn.push({ label: 'Extra Services:', value: extraServices });
      if (cleaningDuration) leftColumn.push({ label: 'Cleaning Duration:', value: cleaningDuration });
      if (estimate.service_scope) leftColumn.push({ label: 'Service Scope:', value: estimate.service_scope });

      // Build right column
      const rightColumn: Array<{ label: string, value: string }> = [];
      if (propertySize) {
        const sizeValue = propertySize.includes('sqft') || propertySize.includes('sq ft') ? propertySize : `${propertySize} sqft`;
        rightColumn.push({ label: 'Property Size:', value: sizeValue });
      }
      if (serviceSchedule) rightColumn.push({ label: 'Service Schedule:', value: serviceSchedule });
      if (startTime) rightColumn.push({ label: 'Time:', value: startTime });

      // Calculate max rows
      const maxRows = Math.max(leftColumn.length, rightColumn.length);

      // Draw table rows
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(darkGrey[0], darkGrey[1], darkGrey[2]);

      for (let i = 0; i < maxRows; i++) {
        const leftItem = leftColumn[i];
        const rightItem = rightColumn[i];

        // Draw row border
        doc.setDrawColor(229, 231, 235); // #e5e7eb
        doc.setLineWidth(0.3);
        doc.line(col1X, yPosition + 2, col1X + (colWidth * 2), yPosition + 2);

        // Draw left column
        if (leftItem) {
          doc.setFont('helvetica', 'bold');
          doc.text(leftItem.label, col1X + 3, yPosition);
          doc.setFont('helvetica', 'normal');
          const valueLines = doc.splitTextToSize(leftItem.value, colWidth - 50);
          valueLines.forEach((line: string, idx: number) => {
            doc.text(line, col1X + 50, yPosition + (idx * 4));
          });
        }

        // Draw right column
        if (rightItem) {
          doc.setFont('helvetica', 'bold');
          doc.text(rightItem.label, col2X + 3, yPosition);
          doc.setFont('helvetica', 'normal');
          const valueLines = doc.splitTextToSize(rightItem.value, colWidth - 50);
          valueLines.forEach((line: string, idx: number) => {
            doc.text(line, col2X + 50, yPosition + (idx * 4));
          });
        }

        // Move to next row
        const leftLines = leftItem ? doc.splitTextToSize(leftItem.value, colWidth - 50).length : 0;
        const rightLines = rightItem ? doc.splitTextToSize(rightItem.value, colWidth - 50).length : 0;
        const maxLines = Math.max(leftLines, rightLines, 1);
        yPosition += Math.max(6, maxLines * 4);
      }
      yPosition += 8;
    }
  }

  // Scope of Work Section (if present)
  if (estimate.service_scope) {
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(darkBlue[0], darkBlue[1], darkBlue[2]);
    doc.text('Scope of Work', margin, yPosition);
    yPosition += 5;
    // Underline
    doc.setDrawColor(darkBlue[0], darkBlue[1], darkBlue[2]);
    doc.setLineWidth(0.5);
    doc.line(margin, yPosition, pageWidth - margin, yPosition);
    yPosition += 8;

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(darkGrey[0], darkGrey[1], darkGrey[2]);
    // Handle multi-line text for scope
    const scopeLines = doc.splitTextToSize(estimate.service_scope, pageWidth - (margin * 2));
    scopeLines.forEach((line: string) => {
      doc.text(line, margin, yPosition);
      yPosition += 4;
    });
    yPosition += 8;
  }

  // Service Breakdown Section (for residential estimates)
  const mainData = estimate.main_data || {};
  const additionalData = estimate.additional_data || {};
  const extraServices = estimate.extra_services || {};

  // Helper to safely get numeric value from data (handles both camelCase and snake_case)
  const getNumericValue = (data: any, camelKey: string, snakeKey?: string) => {
    const value = data[camelKey] ?? data[snakeKey || camelKey.toLowerCase()];
    if (value === null || value === undefined || value === '') return 0;
    const numValue = Number(value);
    return isNaN(numValue) ? 0 : numValue;
  };

  // Format main services
  const mainServices: string[] = [];
  const bedrooms = getNumericValue(mainData, 'bedrooms');
  const kitchens = getNumericValue(mainData, 'kitchens');
  const livingRooms = getNumericValue(mainData, 'livingRooms', 'living_rooms');
  const diningRooms = getNumericValue(mainData, 'diningRooms', 'dining_rooms');
  const offices = getNumericValue(mainData, 'offices');
  const fullBaths = getNumericValue(mainData, 'fullBaths', 'full_baths');
  const halfBaths = getNumericValue(mainData, 'halfBaths', 'half_baths');

  if (bedrooms > 0) mainServices.push(`${bedrooms}x Bedrooms`);
  if (kitchens > 0) mainServices.push(`${kitchens}x Kitchens`);
  if (livingRooms > 0) mainServices.push(`${livingRooms}x Living Rooms`);
  if (diningRooms > 0) mainServices.push(`${diningRooms}x Dining Rooms`);
  if (offices > 0) mainServices.push(`${offices}x Offices`);
  if (fullBaths > 0) mainServices.push(`${fullBaths}x Full Baths`);
  if (halfBaths > 0) mainServices.push(`${halfBaths}x Half Baths`);
  if (mainData.squareFootage || mainData.square_footage) mainServices.push(`1x Square Footage`);

  // Format additional services
  const additionalServices: string[] = [];
  const fans = getNumericValue(additionalData, 'fans');
  const oven = getNumericValue(additionalData, 'oven');
  const refrigerator = getNumericValue(additionalData, 'refrigerator');
  const blinds = getNumericValue(additionalData, 'blinds');
  const windowsInside = getNumericValue(additionalData, 'windowsInside', 'windows_inside');
  const windowsOutside = getNumericValue(additionalData, 'windowsOutside', 'windows_outside');

  if (fans > 0) additionalServices.push(`${fans}x Fans`);
  if (oven > 0) additionalServices.push(`${oven}x Oven`);
  if (refrigerator > 0) additionalServices.push(`${refrigerator}x Refrigerator`);
  if (blinds > 0) additionalServices.push(`${blinds}x Blinds`);
  if (windowsInside > 0) additionalServices.push(`${windowsInside}x Windows Inside`);
  if (windowsOutside > 0) additionalServices.push(`${windowsOutside}x Windows Outside`);

  // Format extra services (boolean values)
  const extraServicesList: string[] = [];
  if (extraServices.baseboard) extraServicesList.push('1x Baseboards');
  if (extraServices.patio) extraServicesList.push('1x Patio');
  if (extraServices.walls) extraServicesList.push('1x Walls');
  if (extraServices.stairs) extraServicesList.push('1x Stairs');
  if (extraServices.cabinetInside || extraServices.cabinet_inside) extraServicesList.push('1x Cabinet Inside');
  if (extraServices.cabinetOutside || extraServices.cabinet_outside) extraServicesList.push('1x Cabinet Outside');
  if (extraServices.washDishes || extraServices.wash_dishes) extraServicesList.push('1x Wash Dishes');
  if (extraServices.hallways) extraServicesList.push('1x Hallways');
  if (extraServices.basement) extraServicesList.push('1x Basement');

  // Only show Service Breakdown if there are any services
  if (mainServices.length > 0 || additionalServices.length > 0 || extraServicesList.length > 0) {
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(darkBlue[0], darkBlue[1], darkBlue[2]);
    doc.text('Service Breakdown', margin, yPosition);
    yPosition += 5;
    // Underline
    doc.setDrawColor(darkBlue[0], darkBlue[1], darkBlue[2]);
    doc.setLineWidth(0.5);
    doc.line(margin, yPosition, pageWidth - margin, yPosition);
    yPosition += 8;

    // Calculate column widths
    const colWidth = (pageWidth - (margin * 2)) / 3;
    const col1X = margin;
    const col2X = margin + colWidth;
    const col3X = margin + (colWidth * 2);

    // Table header with dark blue background
    doc.setFillColor(darkBlue[0], darkBlue[1], darkBlue[2]);
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');

    // Main Services header
    // doc.rect(col1X, yPosition - 3, colWidth, 10, 'F');
    // doc.text('Main Services', col1X + 3, yPosition + 3);

    // Additional Services header
    // doc.rect(col2X, yPosition - 3, colWidth, 10, 'F');
    // doc.text('Additional', col2X + 3, yPosition + 2);
    // doc.text('Services', col2X + 3, yPosition + 6);

    // Extra Services header
    // doc.rect(col3X, yPosition - 3, colWidth, 10, 'F');
    // doc.text('Extra Services', col3X + 3, yPosition + 3);

    yPosition += 10;

    // Calculate max rows needed
    const maxRows = Math.max(mainServices.length, additionalServices.length, extraServicesList.length);

    // Table rows
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(darkGrey[0], darkGrey[1], darkGrey[2]);

    for (let i = 0; i < maxRows; i++) {
      const mainService = mainServices[i] || '';
      const additionalService = additionalServices[i] || '';
      const extraService = extraServicesList[i] || '';

      // Draw row border
      doc.setDrawColor(229, 231, 235); // #e5e7eb
      doc.setLineWidth(0.3);
      doc.line(col1X, yPosition + 2, col1X + (colWidth * 3), yPosition + 2);

      // Calculate max lines needed for this row
      const mainLines = mainService ? doc.splitTextToSize(mainService, colWidth - 6).length : 0;
      const additionalLines = additionalService ? doc.splitTextToSize(additionalService, colWidth - 6).length : 0;
      const extraLines = extraService ? doc.splitTextToSize(extraService, colWidth - 6).length : 0;
      const maxLines = Math.max(mainLines, additionalLines, extraLines, 1);

      // Draw text
      if (mainService) {
        const lines = doc.splitTextToSize(mainService, colWidth - 6);
        lines.forEach((line: string, idx: number) => {
          doc.text(line, col1X + 3, yPosition + (idx * 4));
        });
      }
      if (additionalService) {
        const lines = doc.splitTextToSize(additionalService, colWidth - 6);
        lines.forEach((line: string, idx: number) => {
          doc.text(line, col2X + 3, yPosition + (idx * 4));
        });
      }
      if (extraService) {
        const lines = doc.splitTextToSize(extraService, colWidth - 6);
        lines.forEach((line: string, idx: number) => {
          doc.text(line, col3X + 3, yPosition + (idx * 4));
        });
      }

      // Move to next row (use max height of all three columns)
      yPosition += Math.max(6, maxLines * 4);
    }
    yPosition += 8;
  }

  // Pricing Section
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(darkBlue[0], darkBlue[1], darkBlue[2]);
  doc.text('Pricing', margin, yPosition);
  yPosition += 5;
  // Underline
  doc.setDrawColor(darkBlue[0], darkBlue[1], darkBlue[2]);
  doc.setLineWidth(0.5);
  doc.line(margin, yPosition, pageWidth - margin, yPosition);
  yPosition += 10;

  // Light green box for pricing
  const pricingBoxHeight = estimate.discount_value && estimate.discount_value > 0 ? 40 : 32;
  doc.setFillColor(lightGreen[0], lightGreen[1], lightGreen[2]);
  doc.rect(margin, yPosition - 5, pageWidth - (margin * 2), pricingBoxHeight, 'F');

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(darkGrey[0], darkGrey[1], darkGrey[2]);
  doc.text('Subtotal:', margin + 8, yPosition);
  doc.text(`$${formatCurrency(estimate.subtotal || 0)}`, pageWidth - margin - 8, yPosition, { align: 'right' });
  yPosition += 6;

  if (estimate.discount_value && estimate.discount_value > 0) {
    const discount = estimate.discount_type === 'percentage'
      ? (estimate.subtotal * estimate.discount_value / 100)
      : estimate.discount_value;
    doc.text('Discount:', margin + 8, yPosition);
    doc.text(`-$${formatCurrency(discount)}`, pageWidth - margin - 8, yPosition, { align: 'right' });
    yPosition += 6;
  }

  // Total with border top
  doc.setDrawColor(209, 213, 219); // #d1d5db
  doc.setLineWidth(0.5);
  doc.line(margin + 8, yPosition, pageWidth - margin - 8, yPosition);
  yPosition += 8;

  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(darkBlue[0], darkBlue[1], darkBlue[2]);
  doc.text('Total:', margin + 8, yPosition);
  doc.text(`$${formatCurrency(estimate.total || 0)}`, pageWidth - margin - 8, yPosition, { align: 'right' });
  yPosition += 15;

  // ===== FOOTER (Dark Blue Banner) =====
  const footerY = pageHeight - 20;
  doc.setFillColor(darkBlue[0], darkBlue[1], darkBlue[2]);
  doc.rect(0, footerY, pageWidth, 20, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text('Service provided by', pageWidth / 2, footerY + 6, { align: 'center' });
  doc.text('© 2024 Thunder Pro Inc. | www.thunderpro.co', pageWidth / 2, footerY + 14, { align: 'center' });

  // Convert to Uint8Array for response
  const pdfOutput = doc.output('arraybuffer');
  return new Uint8Array(pdfOutput);
}

serve(async (req: Request): Promise<Response> => {
  return await Sentry.withScope(async (scope) => {
    Sentry.setTag("function", "download-estimate-pdf");

    if (req.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // Get token from URL query parameter
      const url = new URL(req.url);
      const token = url.searchParams.get('token');

      if (!token) {
        return new Response(
          JSON.stringify({ error: 'Missing token parameter' }),
          { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
        );
      }

      // Create Supabase client with service role key
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
      );

      // Fetch estimate by public_share_token or by ID (fallback)
      // First try to find by public_share_token, if not found, try by ID
      let estimate;
      let estimateError;

      const { data: estimateByToken, error: tokenError } = await supabase
        .from('estimates')
        .select('*')
        .eq('public_share_token', token)
        .maybeSingle();

      if (tokenError || !estimateByToken) {
        // Fallback: try to find by ID (in case token is actually an estimate ID)
        const { data: estimateById, error: idError } = await supabase
          .from('estimates')
          .select('*')
          .eq('id', token)
          .maybeSingle();

        estimate = estimateById;
        estimateError = idError;
      } else {
        estimate = estimateByToken;
        estimateError = null;
      }

      if (estimateError || !estimate) {
        return new Response(
          JSON.stringify({ error: 'Estimate not found' }),
          { status: 404, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
        );
      }

      // Fetch profile data
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('user_id', estimate.user_id)
        .maybeSingle();

      if (profileError) {
        console.error('Error fetching profile:', profileError);
      }

      // Determine which PDF generator to use based on service type
      const isCommercial = estimate.service_type === 'Commercial';
      console.log(`Generating PDF for ${isCommercial ? 'Commercial' : 'Residential'} estimate`);

      // Generate PDF using the appropriate generator
      const pdfBytes = isCommercial
        ? await generateCommercialProposalPDF(estimate, profile || {})
        : await generateEstimatePDF(estimate, profile || {});

      // Determine filename based on estimate type
      const filenamePrefix = isCommercial ? 'Commercial_Proposal' : 'Estimate';
      const filename = `${filenamePrefix}_${estimate.id.substring(0, 8).toUpperCase()}.pdf`;

      // Return PDF as download
      return new Response(pdfBytes, {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${filename}"`,
          ...corsHeaders,
        },
      });
    } catch (error: any) {
      Sentry.captureException(error);
      console.error('Error generating estimate PDF:', error);
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
      );
    }
  });
});
