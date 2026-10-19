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

function formatSheetPhone(raw: string): string {
  if (!raw?.trim()) return '';
  const digits = raw.replace(/\D/g, '');
  const n = digits.length > 10 ? digits.slice(-10) : digits;
  if (n.length !== 10) return raw.trim();
  return `(${n.slice(0, 3)})${n.slice(3, 6)}-${n.slice(6)}`;
}

function formatDate(dateStr: string): string {
  if (!dateStr) return '';
  try {
    return new Date(dateStr).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  } catch {
    return dateStr;
  }
}

async function generateEstimatePDF(estimate: any, profile: any): Promise<Uint8Array> {
  const jsPDF = (await import('https://esm.sh/jspdf@2.5.1')).default;
  const doc = new jsPDF({ unit: 'mm', format: 'letter' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 12;
  const contentWidth = pageWidth - margin * 2;
  const navy = [18, 52, 99];
  const money = (n: number) => `$${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const num = (source: any, ...keys: string[]) => {
    if (!source) return 0;
    for (const key of keys) {
      const value = source[key];
      if (value === null || value === undefined || value === '') continue;
      const n = Number(value);
      if (!Number.isNaN(n)) return n;
    }
    return 0;
  };

  const main = estimate.main_data || {};
  const additional = estimate.additional_data || {};
  const extra = estimate.extra_services || {};
  const rooms: Array<[string, number]> = [
    ['Bedrooms', num(main, 'bedrooms')],
    ['Bathrooms', num(main, 'bathrooms') || num(main, 'fullBaths', 'full_baths') + num(main, 'halfBaths', 'half_baths')],
    ['Kitchen', num(main, 'kitchens', 'kitchen')],
    ['Office', num(main, 'offices')],
    ['Living Room', num(main, 'livingRooms', 'living_rooms')],
    ['Dining Room', num(main, 'diningRooms', 'dining_rooms')],
  ];
  const extras: Array<[string, number]> = [
    ['Fans', num(additional, 'fans')],
    ['Oven', num(additional, 'oven')],
    ['Refrigerator', num(additional, 'refrigerator')],
    ['Blinds', num(additional, 'blinds')],
    ['Windows Inside', num(additional, 'windowsInside', 'windows_inside')],
    ['Windows Outside', num(additional, 'windowsOutside', 'windows_outside')],
  ];
  const flags: Array<[string, boolean]> = [
    ['Baseboards', !!extra.baseboard],
    ['Patio', !!extra.patio],
    ['Walls', !!extra.walls],
    ['Stairs', !!extra.stairs],
    ['Cabinet Inside', !!(extra.cabinetInside || extra.cabinet_inside)],
    ['Cabinet Outside', !!(extra.cabinetOutside || extra.cabinet_outside)],
    ['Wash Dishes', !!(extra.washDishes || extra.wash_dishes)],
    ['Hallways', !!extra.hallways],
    ['Basement', !!extra.basement],
  ];
  const lines: Array<{ description: string; qty: number; price: number | null; amount: number | null }> = [];
  for (const [description, qty] of rooms) if (qty > 0) lines.push({ description, qty, price: null, amount: null });
  for (const [description, qty] of extras) if (qty > 0) lines.push({ description, qty, price: null, amount: null });
  for (const [description, on] of flags) if (on) lines.push({ description, qty: 1, price: null, amount: null });
  const subtotal = Number(estimate.subtotal) || 0;
  const total = Number(estimate.total) || 0;
  if (lines.length === 0) {
    lines.push({
      description: estimate.service_type === 'Commercial' ? 'Commercial Cleaning Services' : 'Residential Services',
      qty: 1, price: subtotal, amount: subtotal,
    });
  } else {
    lines[0].amount = subtotal;
  }
  const discountValue = Number(estimate.discount_value) || 0;
  const discountAmount = discountValue > 0
    ? (estimate.discount_type === 'percentage' || estimate.discount_type === 'percent'
      ? subtotal * discountValue / 100
      : discountValue)
    : 0;
  const depositOn = !!(additional.deposit_required || additional.depositRequired);
  const depositRaw = num(additional, 'deposit_value', 'depositValue');
  const depositType = String(additional.deposit_type ?? additional.depositType ?? '');
  const deposit = !depositOn || depositRaw <= 0 ? 0
    : (depositType === 'percentage' || depositType === 'percent' ? total * depositRaw / 100 : depositRaw);
  const sqft = num(main, 'squareFootage', 'square_footage', 'propertySize', 'homeSize');
  const homeSize = sqft > 0 ? `${sqft} SQFT` : '';
  const isQuote = estimate.pdf_subtitle === 'Professional Cleaning Quote';
  const title = isQuote ? 'PROFESSIONAL CLEANING QUOTE' : 'PROFESSIONAL CLEANING ESTIMATE';
  const numberLabel = isQuote ? 'QUOTE' : 'ESTIMATE';
  const number = String(estimate.id || '').substring(0, 8).toUpperCase();

  const companyName = profile?.company_name || estimate.company_name || '';
  const companyAddress = profile?.company_address || '';
  const companyCity = [profile?.company_city, profile?.company_state, profile?.company_zip].filter(Boolean).join(' , ');
  const companyPhone = profile?.company_phone || '';
  const companyEmail = profile?.company_email || '';

  let y = margin;
  doc.setFillColor(navy[0], navy[1], navy[2]);
  doc.rect(margin, y, contentWidth, 10, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(title, pageWidth / 2, y + 6.6, { align: 'center' });
  y += 16;

  const logoSize = 22;
  const logoData = await loadLogoForPdf(profile?.company_logo);
  if (logoData) {
    try { doc.addImage(logoData.data, logoData.format, margin, y, logoSize, logoSize); } catch { /* ignore */ }
  }
  const textX = margin + (logoData ? logoSize + 4 : 0);
  doc.setTextColor(0, 0, 0);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(companyName, textX, y + 6);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  const phoneStr = formatSheetPhone(companyPhone);
  const leftColW = Math.max(doc.getTextWidth(companyAddress), doc.getTextWidth(phoneStr));
  const pipeX = textX + leftColW + 3;
  const rightTextX = pipeX + doc.getTextWidth('|') + 3;
  let infoY = y + 12;
  if (companyAddress || companyCity) {
    if (companyAddress) doc.text(companyAddress, textX, infoY);
    if (companyAddress && companyCity) doc.text('|', pipeX, infoY);
    if (companyCity) doc.text(companyCity, companyAddress ? rightTextX : textX, infoY);
    infoY += 5;
  }
  if (phoneStr || companyEmail) {
    if (phoneStr) doc.text(phoneStr, textX, infoY);
    if (phoneStr && companyEmail) doc.text('|', pipeX, infoY);
    if (companyEmail) doc.text(companyEmail, phoneStr ? rightTextX : textX, infoY);
    infoY += 5;
  }
  y = Math.max(y + logoSize, infoY) + 6;

  const labeled = (label: string, value: string, x: number, yy: number) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(0, 0, 0);
    doc.text(label, x, yy);
    doc.setFont('helvetica', 'normal');
    doc.text(value || '', x + doc.getTextWidth(label), yy);
  };

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  const numberLine = `${numberLabel} : ${number}`;
  let blockW = doc.getTextWidth(numberLine);
  doc.setFontSize(10);
  blockW = Math.max(blockW, doc.getTextWidth('SERVICE DETAILS'));
  const pairW = (label: string, value: string) => {
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    const labelWidth = doc.getTextWidth(label);
    doc.setFont('helvetica', 'normal');
    return labelWidth + doc.getTextWidth(value || '');
  };
  blockW = Math.max(
    blockW,
    pairW('Date : ', formatDate(estimate.estimate_date)),
    pairW('Type of service : ', estimate.service_type || ''),
    estimate.service_sub_type ? pairW('Category : ', estimate.service_sub_type) : 0,
    homeSize ? pairW('Home Size : ', homeSize) : 0,
  );
  const rightX = Math.max(margin + 78, pageWidth - margin - blockW);
  let leftY = y;
  let rightY = y;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('CUSTOMER INFORMATION', margin, leftY);
  leftY += 7;
  labeled('Name : ', estimate.client_name || '', margin, leftY); leftY += 5;
  labeled('Phone : ', formatSheetPhone(estimate.phone || ''), margin, leftY); leftY += 5;
  labeled('Email : ', estimate.email || '', margin, leftY); leftY += 5;
  labeled('Address : ', [estimate.address, estimate.apt].filter(Boolean).join(' '), margin, leftY); leftY += 5;
  const clientCity = [estimate.city, [estimate.state, estimate.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  if (clientCity) { doc.setFont('helvetica', 'normal'); doc.text(clientCity, margin, leftY); leftY += 5; }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(`${numberLabel} : ${number}`, rightX, rightY);
  rightY += 7;
  doc.setFontSize(10);
  doc.text('SERVICE DETAILS', rightX, rightY);
  rightY += 6;
  labeled('Date : ', formatDate(estimate.estimate_date), rightX, rightY); rightY += 5;
  labeled('Type of service : ', estimate.service_type || '', rightX, rightY); rightY += 5;
  if (estimate.service_sub_type) { labeled('Category : ', estimate.service_sub_type, rightX, rightY); rightY += 5; }
  if (homeSize) { labeled('Home Size : ', homeSize, rightX, rightY); rightY += 5; }
  y = Math.max(leftY, rightY) + 4;

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
  lines.forEach((line, index) => {
    if (y > pageHeight - 28) {
      doc.addPage(); y = margin; drawHeader();
      doc.setTextColor(0, 0, 0); doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
    }
    doc.setDrawColor(180, 180, 180);
    doc.setLineWidth(0.1);
    const cells = [
      String(index + 1),
      line.description,
      line.price == null ? '---' : money(line.price),
      String(line.qty),
      line.amount == null ? '' : money(line.amount),
    ];
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
  const labelW = Math.max(...['Subtotal :', 'Discount :', 'Deposit :', 'Pending :', 'Total :'].map((label) => doc.getTextWidth(label)));
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
  drawTotalRow('Subtotal :', money(subtotal));
  drawTotalRow('Discount :', money(discountAmount));
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
  doc.text(money(total), amountRight, y, { align: 'right' });
  y += 10;
  drawTotalRow('Deposit :', money(deposit));
  drawTotalRow('Pending :', money(Math.max(0, total - deposit)));

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
    Sentry.setTag("function", "download-estimate-pdf");

    if (req.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // Get token from URL query parameter
      const url = new URL(req.url);
      const token = url.searchParams.get('token')?.trim();

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

      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token);

      // Fetch estimate by public_share_token or by ID (fallback for email links)
      let estimate;
      let estimateError;

      const { data: estimateByToken, error: tokenError } = await supabase
        .from('estimates')
        .select('*')
        .eq('public_share_token', token)
        .maybeSingle();

      if (tokenError) {
        estimateError = tokenError;
      } else if (estimateByToken) {
        estimate = estimateByToken;
        estimateError = null;
      } else if (isUuid) {
        const { data: estimateById, error: idError } = await supabase
          .from('estimates')
          .select('*')
          .eq('id', token)
          .maybeSingle();

        estimate = estimateById;
        estimateError = idError;
      }

      let isQuickQuote = false;

      if (estimateError || !estimate) {
        // Same public Download PDF URL as estimates: token may be a quick quote
        // share token or id. Estimate lookup stays first so estimate emails are unchanged.
        const { data: quoteByToken } = await supabase
          .from('quick_quotes')
          .select('*')
          .eq('public_share_token', token)
          .maybeSingle();

        let quote = quoteByToken;
        if (!quote && isUuid) {
          const { data: quoteById } = await supabase
            .from('quick_quotes')
            .select('*')
            .eq('id', token)
            .maybeSingle();
          quote = quoteById;
        }

        if (quote) {
          isQuickQuote = true;
          estimate = {
            ...quote,
            client_name: quote.recipient_name || '',
            email: quote.recipient_email || '',
            phone: quote.recipient_phone || '',
            address: '',
            apt: '',
            city: '',
            state: '',
            zip: '',
            estimate_date: quote.quote_date,
            pdf_subtitle: 'Professional Cleaning Quote',
          };
          estimateError = null;
        }
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

      // Quick quotes use the residential generator (no client/address). Estimates
      // keep their commercial vs residential split.
      const isCommercial = !isQuickQuote && estimate.service_type === 'Commercial';
      console.log(`Generating PDF for ${isQuickQuote ? 'Quick Quote' : isCommercial ? 'Commercial' : 'Residential'} estimate`);

      const pdfBytes = await generateEstimatePDF(estimate, profile || {});

      // Determine filename based on estimate type
      const filenamePrefix = isQuickQuote ? 'Quote' : isCommercial ? 'Commercial_Proposal' : 'Estimate';
      const filename = `${filenamePrefix}_${estimate.id.substring(0, 8).toUpperCase()}.pdf`;

      // Return PDF as download
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
      console.error('Error generating estimate PDF:', error);
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
      );
    }
  });
});
