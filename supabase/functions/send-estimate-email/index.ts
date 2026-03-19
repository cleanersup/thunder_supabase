import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
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

interface EstimateEmailRequest {
  estimateData: any;
  recipientEmail: string;
  estimateType: 'residential' | 'commercial';
  isUpdate?: boolean;
}

// Client email template - for customers
const generateResidentialClientEmailTemplate = (estimate: any, companyInfo: any, trackingPixelUrl: string, publicSupabaseUrl: string, userTimezone?: string): string => {
  const f = (n: number) => `$${n.toFixed(2)}`;

  // Get today's date - use local date to match server's current day
  const getTodayDate = () => {
    const now = new Date();
    const months = ['January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'];

    // Debug logging
    console.log('=== getTodayDate() Debug (Client Template) ===');
    console.log('Current Date object:', now);
    console.log('ISO String:', now.toISOString());
    console.log('UTC Components - Year:', now.getUTCFullYear(), 'Month:', now.getUTCMonth(), 'Day:', now.getUTCDate());
    console.log('Local Components - Year:', now.getFullYear(), 'Month:', now.getMonth(), 'Day:', now.getDate());
    console.log('Server Timezone:', Intl.DateTimeFormat().resolvedOptions().timeZone);
    console.log('UTC Offset (minutes):', now.getTimezoneOffset());

    // Use local date components (server's timezone) to get today's date
    const year = now.getFullYear();
    const month = now.getMonth();
    const day = now.getDate();
    const formattedDate = `${months[month]} ${day}, ${year}`;

    console.log('Final formatted date:', formattedDate);
    console.log('===========================================');

    return formattedDate;
  };

  // Format estimate date in user's timezone
  // FIX: estimate_date is stored as DATE (YYYY-MM-DD) without timezone info
  // Problem: new Date("2024-12-26") is interpreted as UTC midnight (2024-12-26T00:00:00Z)
  // When formatted in timezone like "America/New_York" (UTC-5), it becomes 2024-12-25T19:00:00 (previous day)
  // Solution: Parse date components and create date at midday in UTC to avoid day shift
  const formatDate = (dateStr: string) => {
    if (!dateStr) return 'N/A';
    try {
      // Parse date string (YYYY-MM-DD format from database)
      const [year, month, day] = dateStr.split('-').map(Number);

      // Create date at midday (12:00) UTC to avoid timezone edge cases
      // This ensures the date stays correct regardless of timezone offset
      const dateAtMidday = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));

      // Format in user's timezone - using midday ensures date is always correct
      return new Intl.DateTimeFormat('en-US', {
        timeZone: userTimezone || 'UTC',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      }).format(dateAtMidday);
    } catch (error) {
      console.error('Error formatting date:', error);
      return dateStr;
    }
  };

  // Helper function to format service breakdown
  const formatServiceBreakdown = () => {
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

    // Format main services - include ALL available fields
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

    // Format additional services - include ALL available fields
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

    // Format extra services (these are boolean values) - include ALL available fields
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
    if (mainServices.length === 0 && additionalServices.length === 0 && extraServicesList.length === 0) {
      return '';
    }

    // Calculate max rows needed
    const maxRows = Math.max(mainServices.length, additionalServices.length, extraServicesList.length);

    let tableRows = '';
    for (let i = 0; i < maxRows; i++) {
      const mainService = mainServices[i] || '';
      const additionalService = additionalServices[i] || '';
      const extraService = extraServicesList[i] || '';

      tableRows += `
        <tr>
          <td style="padding:6px 8px;text-align:left;border-bottom:1px solid #e5e7eb">${mainService}</td>
          <td style="padding:6px 8px;text-align:left;border-bottom:1px solid #e5e7eb">${additionalService}</td>
          <td style="padding:6px 8px;text-align:left;border-bottom:1px solid #e5e7eb">${extraService}</td>
        </tr>`;
    }

    return `
<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Service Breakdown</h3>
<div style="border-top:1px solid #1e3a8a;margin-bottom:12px"></div>
<table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin-bottom:20px">
  <thead>
    <tr style="background-color:#1e3a8a;color:white">
      <th style="padding:10px 8px;text-align:left;font-weight:bold">Main Services</th>
      <th style="padding:10px 8px;text-align:left;font-weight:bold">Additional Services</th>
      <th style="padding:10px 8px;text-align:left;font-weight:bold">Extra Services</th>
    </tr>
  </thead>
  <tbody>
    ${tableRows}
  </tbody>
</table>`;
  };

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
@media only screen and (max-width: 600px) {
  .email-container {
    max-width: 100% !important;
  }
  .email-body {
    padding: 10px !important;
  }
  .email-content {
    padding: 10px !important;
  }
}
</style>
</head>
<body style="margin:0;padding:20px;font-family:Arial,sans-serif">
<div class="email-container" style="max-width:600px;margin:0 auto">

<div class="email-body" style="text-align:center;padding:15px;background:#1e3a8a;color:white">
<h1 style="margin:0;font-size:22px">${estimate.company_name || 'Company'}</h1>
<p style="margin:5px 0">Professional Cleaning Estimate</p>
</div>

<div class="email-content" style="padding:15px">

<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Client Information</h3>
<div style="border-top:1px solid #1e3a8a;margin-bottom:12px"></div>
<p><strong>Name:</strong> ${estimate.client_name}<br>
<strong>Email:</strong> ${estimate.email}<br>
<strong>Phone:</strong> ${estimate.phone}<br>
<strong>Address:</strong> ${estimate.address}${estimate.apt ? `, ${estimate.apt}` : ''}, ${estimate.city}, ${estimate.state} ${estimate.zip}</p>

<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Service Details</h3>
<div style="border-top:1px solid #1e3a8a;margin-bottom:12px"></div>
<p><strong>Date:</strong> ${getTodayDate()}<br>
<strong>Service Type:</strong> ${estimate.service_type}${estimate.service_sub_type ? ` - ${estimate.service_sub_type}` : ''}</p>

${estimate.service_scope ? `<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Scope of Work</h3><div style="border-top:1px solid #1e3a8a;margin-bottom:12px"></div><p>${estimate.service_scope}</p>` : ''}

${formatServiceBreakdown()}

<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Pricing</h3>
<table cellpadding="0" cellspacing="0" style="width:100%;background-color:#f0fdf4">
  <tr>
    <td style="padding:16px">
      <table cellpadding="0" cellspacing="0" style="width:100%">
        <tr>
          <td style="padding:8px 0;text-align:left">Subtotal:</td>
          <td style="padding:8px 0;text-align:right">${f(estimate.subtotal || 0)}</td>
        </tr>
        ${estimate.discount_value && estimate.discount_value > 0 ? `
        <tr>
          <td style="padding:8px 0;text-align:left">Discount:</td>
          <td style="padding:8px 0;text-align:right">-${f(estimate.discount_type === 'percentage' ? (estimate.subtotal * estimate.discount_value / 100) : estimate.discount_value)}</td>
        </tr>` : ''}
        <tr>
          <td style="padding:12px 0 0 0;text-align:left;font-weight:bold;font-size:20px;color:#1e3a8a;border-top:1px solid #d1d5db">Total:</td>
          <td style="padding:12px 0 0 0;text-align:right;font-weight:bold;font-size:20px;color:#1e3a8a;border-top:1px solid #d1d5db">${f(estimate.total || 0)}</td>
        </tr>
      </table>
    </td>
  </tr>
</table>

<div style="text-align:center;margin:30px 0">
<a href="${publicSupabaseUrl}/functions/v1/accept-estimate?id=${estimate.id}" style="display:inline-block;background:#10b981;color:white;padding:15px 40px;text-decoration:none;border-radius:5px;font-weight:bold;margin:10px">Accept Estimate</a>
<a href="${publicSupabaseUrl}/functions/v1/download-estimate-pdf?token=${estimate.public_share_token || estimate.id}" style="display:inline-block;background:#1e3a8a;color:white;padding:15px 40px;text-decoration:none;border-radius:5px;font-weight:bold;margin:10px">Download PDF</a>
</div>

</div>

<div style="text-align:center;padding:15px;background:#1e3a8a;color:white">
<p style="margin:0 0 5px 0;font-size:12px">Service provided by</p>
<p style="margin:0">© 2024 Thunder Pro Inc. | <a href="https://www.thunderpro.co" style="color:white">www.thunderpro.co</a></p>
</div>

<!-- Tracking pixel to mark email as viewed -->
<img src="${trackingPixelUrl}" width="1" height="1" style="display:none;" alt="" />

</div>
</body>
</html>`;
};

// Owner/User email template - for business owner (same design as client initially)
const generateResidentialOwnerEmailTemplate = (estimate: any, companyInfo: any, publicSupabaseUrl: string, userTimezone?: string): string => {
  const f = (n: number) => `$${n.toFixed(2)}`;

  // Get today's date - use local date to match server's current day
  const getTodayDate = () => {
    const now = new Date();
    const months = ['January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'];

    // Debug logging
    console.log('=== getTodayDate() Debug (Owner Template) ===');
    console.log('Current Date object:', now);
    console.log('ISO String:', now.toISOString());
    console.log('UTC Components - Year:', now.getUTCFullYear(), 'Month:', now.getUTCMonth(), 'Day:', now.getUTCDate());
    console.log('Local Components - Year:', now.getFullYear(), 'Month:', now.getMonth(), 'Day:', now.getDate());
    console.log('Server Timezone:', Intl.DateTimeFormat().resolvedOptions().timeZone);
    console.log('UTC Offset (minutes):', now.getTimezoneOffset());

    // Use local date components (server's timezone) to get today's date
    const year = now.getFullYear();
    const month = now.getMonth();
    const day = now.getDate();
    const formattedDate = `${months[month]} ${day}, ${year}`;

    console.log('Final formatted date:', formattedDate);
    console.log('===========================================');

    return formattedDate;
  };

  // Format estimate date in user's timezone
  // FIX: estimate_date is stored as DATE (YYYY-MM-DD) without timezone info
  // Problem: new Date("2024-12-26") is interpreted as UTC midnight (2024-12-26T00:00:00Z)
  // When formatted in timezone like "America/New_York" (UTC-5), it becomes 2024-12-25T19:00:00 (previous day)
  // Solution: Parse date components and create date at midday in UTC to avoid day shift
  const formatDate = (dateStr: string) => {
    if (!dateStr) return 'N/A';
    try {
      // Parse date string (YYYY-MM-DD format from database)
      const [year, month, day] = dateStr.split('-').map(Number);

      // Create date at midday (12:00) UTC to avoid timezone edge cases
      // This ensures the date stays correct regardless of timezone offset
      const dateAtMidday = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));

      // Format in user's timezone - using midday ensures date is always correct
      return new Intl.DateTimeFormat('en-US', {
        timeZone: userTimezone || 'UTC',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      }).format(dateAtMidday);
    } catch (error) {
      console.error('Error formatting date:', error);
      return dateStr;
    }
  };

  // Helper function to format service breakdown
  const formatServiceBreakdown = () => {
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

    // Format main services - include ALL available fields
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

    // Format additional services - include ALL available fields
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

    // Format extra services (these are boolean values) - include ALL available fields
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
    if (mainServices.length === 0 && additionalServices.length === 0 && extraServicesList.length === 0) {
      return '';
    }

    // Calculate max rows needed
    const maxRows = Math.max(mainServices.length, additionalServices.length, extraServicesList.length);

    let tableRows = '';
    for (let i = 0; i < maxRows; i++) {
      const mainService = mainServices[i] || '';
      const additionalService = additionalServices[i] || '';
      const extraService = extraServicesList[i] || '';

      tableRows += `
        <tr>
          <td style="padding:6px 8px;text-align:left;border-bottom:1px solid #e5e7eb">${mainService}</td>
          <td style="padding:6px 8px;text-align:left;border-bottom:1px solid #e5e7eb">${additionalService}</td>
          <td style="padding:6px 8px;text-align:left;border-bottom:1px solid #e5e7eb">${extraService}</td>
        </tr>`;
    }

    return `
<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Service Breakdown</h3>
<div style="border-top:1px solid #1e3a8a;margin-bottom:12px"></div>
<table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin-bottom:20px">
  <thead>
    <tr style="background-color:#1e3a8a;color:white">
      <th style="padding:10px 8px;text-align:left;font-weight:bold">Main Services</th>
      <th style="padding:10px 8px;text-align:left;font-weight:bold">Additional Services</th>
      <th style="padding:10px 8px;text-align:left;font-weight:bold">Extra Services</th>
    </tr>
  </thead>
  <tbody>
    ${tableRows}
  </tbody>
</table>`;
  };

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
@media only screen and (max-width: 600px) {
  .email-container {
    max-width: 100% !important;
  }
  .email-body {
    padding: 10px !important;
  }
  .email-content {
    padding: 10px !important;
  }
}
</style>
</head>
<body style="margin:0;padding:20px;font-family:Arial,sans-serif">
<div class="email-container" style="max-width:600px;margin:0 auto">

<div class="email-body" style="text-align:center;padding:15px;background:#1e3a8a;color:white">
<p style="margin:0;font-size:14px;font-weight:bold;background:#1e40af;padding:8px;border-radius:4px">OWNER COPY - INTERNAL USE ONLY</p>
<h1 style="margin:10px 0 0 0;font-size:22px">${estimate.company_name || 'Company'}</h1>
<p style="margin:5px 0">Professional Cleaning Estimate</p>
</div>

<div class="email-content" style="padding:15px">

<div style="background:#f0fdf4;padding:12px;border-left:4px solid #10b981;margin-bottom:15px">
<p style="margin:0;font-weight:bold;color:#059669">Internal Cost Breakdown</p>
<p style="margin:5px 0 0 0;font-size:13px">
<strong>Labor Cost:</strong> $${(estimate.labor_cost || 0).toFixed(2)} | 
<strong>Supplies:</strong> $${(estimate.supplies_cost || 0).toFixed(2)} | 
<strong>Overhead:</strong> $${(estimate.overhead_cost || 0).toFixed(2)}<br>
<strong>Total Costs:</strong> $${(estimate.total_operation_cost || 0).toFixed(2)} | 
<strong>Profit:</strong> $${((estimate.total || 0) - (estimate.total_operation_cost || 0)).toFixed(2)} 
(${(((estimate.total || 0) - (estimate.total_operation_cost || 0)) / (estimate.total || 1) * 100).toFixed(1)}%)
</p>
</div>

<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Client Information</h3>
<div style="border-top:1px solid #1e3a8a;margin-bottom:12px"></div>
<p><strong>Name:</strong> ${estimate.client_name}<br>
<strong>Email:</strong> ${estimate.email}<br>
<strong>Phone:</strong> ${estimate.phone}<br>
<strong>Address:</strong> ${estimate.address}${estimate.apt ? `, ${estimate.apt}` : ''}, ${estimate.city}, ${estimate.state} ${estimate.zip}</p>

<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Service Details</h3>
<div style="border-top:1px solid #1e3a8a;margin-bottom:12px"></div>
<p><strong>Date:</strong> ${getTodayDate()}<br>
<strong>Service Type:</strong> ${estimate.service_type}${estimate.service_sub_type ? ` - ${estimate.service_sub_type}` : ''}</p>

${estimate.service_scope ? `<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Scope of Work</h3><div style="border-top:1px solid #1e3a8a;margin-bottom:12px"></div><p>${estimate.service_scope}</p>` : ''}

${formatServiceBreakdown()}

<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Pricing</h3>
<table cellpadding="0" cellspacing="0" style="width:100%;background-color:#f0fdf4">
  <tr>
    <td style="padding:16px">
      <table cellpadding="0" cellspacing="0" style="width:100%">
        <tr>
          <td style="padding:8px 0;text-align:left">Subtotal:</td>
          <td style="padding:8px 0;text-align:right">${f(estimate.subtotal || 0)}</td>
        </tr>
        ${estimate.discount_value && estimate.discount_value > 0 ? `
        <tr>
          <td style="padding:8px 0;text-align:left">Discount:</td>
          <td style="padding:8px 0;text-align:right">-${f(estimate.discount_type === 'percentage' ? (estimate.subtotal * estimate.discount_value / 100) : estimate.discount_value)}</td>
        </tr>` : ''}
        <tr>
          <td style="padding:12px 0 0 0;text-align:left;font-weight:bold;font-size:20px;color:#1e3a8a;border-top:1px solid #d1d5db">Total:</td>
          <td style="padding:12px 0 0 0;text-align:right;font-weight:bold;font-size:20px;color:#1e3a8a;border-top:1px solid #d1d5db">${f(estimate.total || 0)}</td>
        </tr>
      </table>
    </td>
  </tr>
</table>

<div style="text-align:center;margin:30px 0">
<a href="${publicSupabaseUrl}/functions/v1/download-estimate-pdf?token=${estimate.public_share_token || estimate.id}" style="display:inline-block;background:#1e3a8a;color:white;padding:15px 40px;text-decoration:none;border-radius:5px;font-weight:bold;margin:10px">Download PDF</a>
</div>

</div>

<div style="text-align:center;padding:15px;background:#1e3a8a;color:white">
<p style="margin:0 0 5px 0;font-size:12px">Service provided by</p>
<p style="margin:0">© 2024 Thunder Pro Inc. | <a href="https://www.thunderpro.co" style="color:white">www.thunderpro.co</a></p>
</div>

</div>
</body>
</html>`;
};

// Helper function to format commercial specifications
const formatCommercialSpecifications = (estimate: any): string => {
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
  const serviceType = getValue(mainData.serviceType);
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
  if (!propertyType && !serviceType && !extraServices && !cleaningDuration && !propertySize && !serviceSchedule && !startTime && !estimate.service_scope) {
    return '';
  }

  // Build left column
  const leftColumn: string[] = [];
  if (propertyType) leftColumn.push(`<strong>Property Type:</strong> ${propertyType}`);
  if (serviceType) leftColumn.push(`<strong>Service Type:</strong> ${serviceType}`);
  if (extraServices) leftColumn.push(`<strong>Extra Services:</strong> ${extraServices}`);
  if (cleaningDuration) leftColumn.push(`<strong>Cleaning Duration:</strong> ${cleaningDuration}`);
  if (estimate.service_scope) leftColumn.push(`<strong>Service Scope:</strong> ${estimate.service_scope}`);

  // Build right column
  const rightColumn: string[] = [];
  if (propertySize) {
    const sizeValue = propertySize.includes('sqft') || propertySize.includes('sq ft') ? propertySize : `${propertySize} sqft`;
    rightColumn.push(`<strong>Property Size:</strong> ${sizeValue}`);
  }
  if (serviceSchedule) rightColumn.push(`<strong>Service Schedule:</strong> ${serviceSchedule}`);
  if (startTime) rightColumn.push(`<strong>Time:</strong> ${startTime}`);

  // Calculate max rows
  const maxRows = Math.max(leftColumn.length, rightColumn.length);

  let tableRows = '';
  for (let i = 0; i < maxRows; i++) {
    const leftCell = leftColumn[i] || '';
    const rightCell = rightColumn[i] || '';
    tableRows += `
      <tr>
        <td style="padding:6px 8px;text-align:left;vertical-align:top;border-bottom:1px solid #e5e7eb">${leftCell}</td>
        <td style="padding:6px 8px;text-align:left;vertical-align:top;border-bottom:1px solid #e5e7eb">${rightCell}</td>
      </tr>`;
  }

  return `
<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Service Specifications</h3>
<div style="border-top:1px solid #1e3a8a;margin-bottom:12px"></div>
<table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin-bottom:20px">
  <tbody>
    ${tableRows}
  </tbody>
</table>`;
};

// Function to generate commercial estimate HTML template  
const generateCommercialClientEmailTemplate = (estimate: any, companyInfo: any, trackingPixelUrl: string, publicSupabaseUrl: string, userTimezone?: string): string => {
  // Get the residential template HTML
  const residentialHtml = generateResidentialClientEmailTemplate(estimate, companyInfo, trackingPixelUrl, publicSupabaseUrl, userTimezone);

  // Replace "Residential" with "Commercial"
  let commercialHtml = residentialHtml.replace(/Residential/g, 'Commercial');

  // Add commercial specifications section after Service Details and before Scope of Work/Service Breakdown
  const specificationsSection = formatCommercialSpecifications(estimate);

  if (specificationsSection) {
    // Insert specifications section after Service Details section (after </p> tag)
    // Look for the pattern: Service Type line ends with </p>, then either Scope of Work or Service Breakdown or Pricing
    const serviceDetailsEndPattern = /(<strong>Service Type:<\/strong>.*?<\/p>)/;

    // Try to insert before Scope of Work first
    if (commercialHtml.includes('<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Scope of Work</h3>')) {
      commercialHtml = commercialHtml.replace(
        /(<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Scope of Work<\/h3>)/,
        `${specificationsSection}$1`
      );
    }
    // Otherwise insert before Service Breakdown
    else if (commercialHtml.includes('<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Service Breakdown</h3>')) {
      commercialHtml = commercialHtml.replace(
        /(<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Service Breakdown<\/h3>)/,
        `${specificationsSection}$1`
      );
    }
    // Otherwise insert after Service Details section (before Pricing)
    else {
      commercialHtml = commercialHtml.replace(
        /(<strong>Service Type:<\/strong>.*?<\/p>)/,
        `$1${specificationsSection}`
      );
    }
  }

  return commercialHtml;
};

const generateCommercialOwnerEmailTemplate = (estimate: any, companyInfo: any, publicSupabaseUrl: string, userTimezone?: string): string => {
  // Get the residential template HTML
  const residentialHtml = generateResidentialOwnerEmailTemplate(estimate, companyInfo, publicSupabaseUrl, userTimezone);

  // Replace "Residential" with "Commercial"
  let commercialHtml = residentialHtml.replace(/Residential/g, 'Commercial');

  // Add commercial specifications section after Service Details and before Scope of Work/Service Breakdown
  const specificationsSection = formatCommercialSpecifications(estimate);

  if (specificationsSection) {
    // Insert specifications section after Service Details section (after </p> tag)
    // Try to insert before Scope of Work first
    if (commercialHtml.includes('<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Scope of Work</h3>')) {
      commercialHtml = commercialHtml.replace(
        /(<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Scope of Work<\/h3>)/,
        `${specificationsSection}$1`
      );
    }
    // Otherwise insert before Service Breakdown
    else if (commercialHtml.includes('<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Service Breakdown</h3>')) {
      commercialHtml = commercialHtml.replace(
        /(<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Service Breakdown<\/h3>)/,
        `${specificationsSection}$1`
      );
    }
    // Otherwise insert after Service Details section (before Pricing)
    else {
      commercialHtml = commercialHtml.replace(
        /(<strong>Service Type:<\/strong>.*?<\/p>)/,
        `$1${specificationsSection}`
      );
    }
  }

  return commercialHtml;
};

// Function to convert file to base64 (for embedding badges in email)
async function getImageAsBase64(imagePath: string): Promise<string> {
  try {
    const response = await fetch(imagePath);
    const blob = await response.blob();
    const buffer = await blob.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
    return `data:${blob.type};base64,${base64}`;
  } catch (error) {
    console.error('Error loading image:', error);
    return '';
  }
}

// Optimized SMTP implementation for large HTML emails
async function sendEmailViaSMTP(
  toEmail: string,
  bccEmail: string | null,
  subject: string,
  htmlContent: string
): Promise<void> {
  console.log('=== Starting SMTP Email Process ===');

  const smtpHost = "email-smtp.us-east-2.amazonaws.com";
  const smtpPort = 587;
  const smtpUser = Deno.env.get('AWS_SES_SMTP_USERNAME') || '';
  const smtpPass = Deno.env.get('AWS_SES_SMTP_PASSWORD') || '';
  const fromEmail = '"Thunder Pro" <info@thunderpro.co>';

  console.log('Configuration:', {
    smtpHost,
    smtpPort,
    fromEmail,
    toEmail,
    bccEmail,
    subject
  });

  let conn: Deno.TcpConn | null = null;
  let tlsConn: Deno.TlsConn | null = null;

  try {
    console.log('[1/10] Connecting to SMTP server:', `${smtpHost}:${smtpPort}...`);
    conn = await Deno.connect({ hostname: smtpHost, port: smtpPort });
    console.log('[1/10] ✓ TCP connection established');

    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const readResponse = async (connection: Deno.TcpConn | Deno.TlsConn): Promise<string> => {
      const buffer = new Uint8Array(4096);
      const n = await connection.read(buffer);
      return decoder.decode(buffer.subarray(0, n || 0));
    };

    const sendCommand = async (
      connection: Deno.TcpConn | Deno.TlsConn,
      command: string,
      stepName: string,
      maskInLog: boolean = false
    ): Promise<string> => {
      const displayCommand = maskInLog ? command.substring(0, 15) + '...' : command;

      console.log(`${stepName} Sending: ${displayCommand}`);
      await connection.write(encoder.encode(command + '\r\n'));

      const response = await readResponse(connection);
      console.log(`${stepName} Response: ${response.trim()}`);

      const responseCode = response.substring(0, 3);
      if (responseCode.startsWith('4') || responseCode.startsWith('5')) {
        throw new Error(`SMTP Error ${responseCode}: ${response.trim()}`);
      }

      return response;
    };

    console.log('[2/10] Reading server greeting...');
    const greeting = await readResponse(conn);
    console.log('[2/10] ✓ Server greeting:', greeting.trim());

    await sendCommand(conn, 'EHLO thunderpro.co', '[3/10]');
    await sendCommand(conn, 'STARTTLS', '[4/10]');

    console.log('[5/10] Upgrading to TLS...');
    tlsConn = await Deno.startTls(conn, { hostname: smtpHost });
    console.log('[5/10] ✓ TLS established');

    await sendCommand(tlsConn, 'EHLO thunderpro.co', '[6/10]');

    console.log('[7/10] Sending: AUTH LOGIN...');
    await tlsConn.write(encoder.encode('AUTH LOGIN\r\n'));
    await readResponse(tlsConn);
    console.log('[7/10] Response: 334 VXNlcm5hbWU6');

    await sendCommand(tlsConn, btoa(smtpUser), '[7/10]', true);
    await sendCommand(tlsConn, btoa(smtpPass), '[7/10]', true);
    console.log('[7/10] ✓ Authentication successful');

    await sendCommand(tlsConn, `MAIL FROM:<info@thunderpro.co>`, '[8/10]');
    await sendCommand(tlsConn, `RCPT TO:<${toEmail}>`, '[8/10]');
    console.log('[8/10] Response: 250 Ok');

    if (bccEmail && bccEmail !== toEmail) {
      await sendCommand(tlsConn, `RCPT TO:<${bccEmail}>`, '[8/10]');
      console.log('[8/10] ✓ BCC recipient added');
    }

    await sendCommand(tlsConn, 'DATA', '[9/10]');

    // Build email in chunks to avoid memory issues
    console.log('[9/10] Sending email headers...');

    // Generate unique identifiers to prevent Gmail threading/grouping
    const timestamp = Date.now();
    const randomId = Math.random().toString(36).substring(2, 15);
    const messageId = `<${timestamp}.${randomId}@thunderpro.co>`;
    const uniqueRef = `${timestamp}-${randomId}`;

    const headers = [
      `From: ${fromEmail}`,
      `To: ${toEmail}`,
      `Subject: ${subject}`,
      `Message-ID: ${messageId}`,
      `X-Entity-Ref-ID: ${uniqueRef}`,
      `X-Mailer: ThunderPro-Estimates`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=UTF-8',
      '',
    ].join('\r\n');

    await tlsConn.write(encoder.encode(headers + '\r\n'));

    // Send HTML content in smaller chunks (4KB at a time)
    console.log('[9/10] Sending email body in chunks...');
    const chunkSize = 4096;
    const contentBytes = encoder.encode(htmlContent);

    for (let i = 0; i < contentBytes.length; i += chunkSize) {
      const chunk = contentBytes.slice(i, Math.min(i + chunkSize, contentBytes.length));
      await tlsConn.write(chunk);
    }

    // Send end marker
    await tlsConn.write(encoder.encode('\r\n.\r\n'));

    const dataResponse = await readResponse(tlsConn);
    console.log('[9/10] ✓ Email sent:', dataResponse.trim());

    await sendCommand(tlsConn, 'QUIT', '[10/10]');
    tlsConn.close();
    console.log('=== Email sent successfully ===');

  } catch (error: any) {
    console.error('=== SMTP Error ===');
    console.error('Error:', error.message);

    try {
      if (tlsConn) tlsConn.close();
      if (conn) conn.close();
    } catch (closeError) {
      console.error('Error closing connections:', closeError);
    }

    throw new Error(`Failed to send email via SMTP: ${error.message}`);
  }
}

const handler = async (req: Request): Promise<Response> => {
  return await Sentry.withScope(async (scope) => {
    Sentry.setTag("function", "send-estimate-email");

    if (req.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      const { estimateData, recipientEmail, estimateType, isUpdate }: EstimateEmailRequest = await req.json();

      // Debug: Log current date/time when function is called
      const functionCallTime = new Date();
      console.log('=== send-estimate-email Function Called ===');
      console.log('Function call timestamp:', functionCallTime.toISOString());
      console.log('Function call local time:', functionCallTime.toString());
      console.log('Function call UTC date:', functionCallTime.getUTCFullYear() + '-' + (functionCallTime.getUTCMonth() + 1) + '-' + functionCallTime.getUTCDate());
      console.log('Function call local date:', functionCallTime.getFullYear() + '-' + (functionCallTime.getMonth() + 1) + '-' + functionCallTime.getDate());
      console.log('Estimate date from DB:', estimateData?.estimate_date);
      console.log('==========================================');

      console.log('Processing estimate email request:', {
        estimateType,
        recipientEmail,
        estimateId: estimateData?.id
      });

      if (!estimateData || !recipientEmail || !estimateType) {
        throw new Error('Missing required fields: estimateData, recipientEmail, or estimateType');
      }

      // Get the company email and timezone from profiles table
      const authHeader = req.headers.get('Authorization');
      console.log('Auth header present:', !!authHeader);

      let ownerEmail: string | null = null;
      let userTimezone: string = 'UTC';

      if (authHeader) {
        try {
          const token = authHeader.replace('Bearer ', '');
          const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2.76.1');
          const supabaseClient = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_ANON_KEY') ?? '',
            { global: { headers: { Authorization: authHeader } } }
          );

          // First get the authenticated user ID
          const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token);
          console.log('User auth check:', { userId: user?.id, error: authError?.message });

          if (user?.id) {
            // Now get the company_email and timezone from profiles table
            const { data: profile, error: profileError } = await supabaseClient
              .from('profiles')
              .select('company_email, timezone')
              .eq('user_id', user.id)
              .single();

            console.log('Profile query:', {
              userId: user.id,
              companyEmail: profile?.company_email,
              timezone: profile?.timezone,
              error: profileError?.message
            });

            if (profile?.company_email) {
              ownerEmail = profile.company_email;
              console.log('✓ Owner email obtained from company profile:', ownerEmail);
            } else {
              console.log('⚠️ Profile found but no company_email available');
            }

            if (profile?.timezone) {
              userTimezone = profile.timezone;
              console.log('✓ User timezone:', userTimezone);
            } else {
              console.log('⚠️ No timezone found, using UTC');
            }
          } else {
            console.log('⚠️ User not authenticated');
          }
        } catch (error: any) {
          console.error('Error getting company email:', error.message);
        }
      } else {
        console.log('⚠️ No Authorization header found - company email will not be copied');
      }

      console.log('Final company email for BCC:', ownerEmail);

      const companyInfo = {
        company_name: 'Thunder Pro',
        company_logo: estimateData.company_logo || '',
        company_email: 'info@thunderpro.co', // Static company email
        company_phone: estimateData.phone || '',
      };

      // Public URL for Edge Functions (download PDF, links, tracking pixel)
      // Must be publicly accessible - SUPABASE_URL may be internal (e.g. kong:8000)
      const publicSupabaseUrl = Deno.env.get('PUBLIC_APP_URL') || Deno.env.get('APP_URL') || 'https://staging.thunderpro.co';

      // Generate tracking pixel URL (use public URL so email clients can reach it)
      const trackingPixelUrl = `${publicSupabaseUrl}/functions/v1/mark-viewed?type=estimate&id=${estimateData.id}`;

      let clientHtmlContent: string;
      let ownerHtmlContent: string;
      let clientSubject: string;
      let ownerSubject: string;
      const companyName = estimateData.company_name || 'Company Name';

      if (estimateType === 'residential') {
        clientSubject = isUpdate ? `You have an Updated estimate - ${companyName}` : `Residential Cleaning Estimate - ${companyName}`;
        ownerSubject = isUpdate ? `An estimate was updated for ${estimateData.client_name}` : `An estimate was sent to ${estimateData.client_name}`;
        clientHtmlContent = generateResidentialClientEmailTemplate(estimateData, companyInfo, trackingPixelUrl, publicSupabaseUrl, userTimezone);
        ownerHtmlContent = generateResidentialOwnerEmailTemplate(estimateData, companyInfo, publicSupabaseUrl, userTimezone);
      } else {
        clientSubject = isUpdate ? `You have an Updated estimate - ${companyName}` : `Commercial Cleaning Estimate - ${companyName}`;
        ownerSubject = isUpdate ? `An estimate was updated for ${estimateData.client_name}` : `An estimate was sent to ${estimateData.client_name}`;
        clientHtmlContent = generateCommercialClientEmailTemplate(estimateData, companyInfo, trackingPixelUrl, publicSupabaseUrl, userTimezone);
        ownerHtmlContent = generateCommercialOwnerEmailTemplate(estimateData, companyInfo, publicSupabaseUrl, userTimezone);
      }

      // Debug: Extract and log the date from the generated HTML
      console.log('=== Generated HTML Date Check ===');
      const dateMatch = clientHtmlContent.match(/<strong>Date:<\/strong>\s*([^<]+)/);
      if (dateMatch) {
        console.log('Date found in HTML:', dateMatch[1].trim());
      } else {
        console.log('⚠️ Date pattern not found in HTML');
        // Try alternative pattern
        const altMatch = clientHtmlContent.match(/Date:.*?(\w+\s+\d+,\s+\d{4})/);
        if (altMatch) {
          console.log('Date found (alternative pattern):', altMatch[1]);
        }
      }
      // Log a snippet of HTML around the date
      const dateIndex = clientHtmlContent.indexOf('Date:');
      if (dateIndex !== -1) {
        const snippet = clientHtmlContent.substring(Math.max(0, dateIndex - 50), Math.min(clientHtmlContent.length, dateIndex + 200));
        console.log('HTML snippet around Date:', snippet);
      }
      console.log('===================================');

      // Send email to client
      console.log(`Sending email to client: ${recipientEmail}`);
      await sendEmailViaSMTP(recipientEmail, null, clientSubject, clientHtmlContent);
      console.log('✓ Client email sent successfully');

      // Wait 3 seconds before sending owner email to prevent Gmail threading
      if (ownerEmail && ownerEmail !== recipientEmail) {
        console.log('Waiting 3 seconds before sending owner email...');
        await new Promise(resolve => setTimeout(resolve, 3000));

        console.log(`Sending copy to owner: ${ownerEmail}`);
        await sendEmailViaSMTP(ownerEmail, null, ownerSubject, ownerHtmlContent);
        console.log('✓ Owner email sent successfully');
      }

      return new Response(
        JSON.stringify({
          success: true,
          message: 'Emails sent successfully',
          recipient: recipientEmail,
          ownerCopied: !!ownerEmail
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        }
      );

    } catch (error: any) {
      Sentry.captureException(error);
      console.error('Error in send-estimate-email function:', error);
      return new Response(
        JSON.stringify({
          success: false,
          error: error.message || 'Failed to send email'
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        }
      );
    }
  });
};

serve(handler);
