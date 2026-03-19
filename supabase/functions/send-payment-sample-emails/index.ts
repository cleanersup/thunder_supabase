import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// SMTP email sending function
async function sendEmailViaSMTP(
  toEmail: string,
  subject: string,
  htmlContent: string
): Promise<void> {
  console.log('=== Starting SMTP Email Process ===');
  
  const smtpHost = "email-smtp.us-east-2.amazonaws.com";
  const smtpPort = 587;
  const smtpUser = Deno.env.get('AWS_SES_SMTP_USERNAME') || '';
  const smtpPass = Deno.env.get('AWS_SES_SMTP_PASSWORD') || '';
  const fromEmail = '"Thunder Pro" <info@thunderpro.co>';

  let conn: Deno.TcpConn | null = null;
  let tlsConn: Deno.TlsConn | null = null;

  try {
    conn = await Deno.connect({ hostname: smtpHost, port: smtpPort });

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
      maskInLog: boolean = false
    ): Promise<string> => {
      await connection.write(encoder.encode(command + '\r\n'));
      const response = await readResponse(connection);
      const responseCode = response.substring(0, 3);
      if (responseCode.startsWith('4') || responseCode.startsWith('5')) {
        throw new Error(`SMTP Error ${responseCode}: ${response.trim()}`);
      }
      return response;
    };

    await readResponse(conn);
    await sendCommand(conn, 'EHLO thunderpro.co');
    await sendCommand(conn, 'STARTTLS');

    tlsConn = await Deno.startTls(conn, { hostname: smtpHost });

    await sendCommand(tlsConn, 'EHLO thunderpro.co');
    await tlsConn.write(encoder.encode('AUTH LOGIN\r\n'));
    await readResponse(tlsConn);

    await sendCommand(tlsConn, btoa(smtpUser), true);
    await sendCommand(tlsConn, btoa(smtpPass), true);

    await sendCommand(tlsConn, `MAIL FROM:<info@thunderpro.co>`);
    await sendCommand(tlsConn, `RCPT TO:<${toEmail}>`);
    await sendCommand(tlsConn, 'DATA');

    const timestamp = Date.now();
    const randomId = Math.random().toString(36).substring(2, 15);
    const messageId = `<${timestamp}.${randomId}@thunderpro.co>`;
    
    const headers = [
      `From: ${fromEmail}`,
      `To: ${toEmail}`,
      `Subject: ${subject}`,
      `Message-ID: ${messageId}`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=UTF-8',
      '',
    ].join('\r\n');
    
    await tlsConn.write(encoder.encode(headers + '\r\n'));

    const chunkSize = 4096;
    const contentBytes = encoder.encode(htmlContent);
    
    for (let i = 0; i < contentBytes.length; i += chunkSize) {
      const chunk = contentBytes.slice(i, Math.min(i + chunkSize, contentBytes.length));
      await tlsConn.write(chunk);
    }
    
    await tlsConn.write(encoder.encode('\r\n.\r\n'));
    await readResponse(tlsConn);
    await sendCommand(tlsConn, 'QUIT');
    tlsConn.close();

  } catch (error: any) {
    console.error('SMTP Error:', error.message);
    try {
      if (tlsConn) tlsConn.close();
      if (conn) conn.close();
    } catch (closeError) {
      console.error('Error closing connections:', closeError);
    }
    throw new Error(`Failed to send email via SMTP: ${error.message}`);
  }
}

// Generate daily sales report email template
const generateSalesReportTemplate = (invoices: any[], totalSales: number, weeklyData: any[], companyName: string): string => {
  const f = (n: number) => `$${n.toFixed(2)}`;
  const today = new Date();
  
  const invoiceListHTML = invoices
    .map(inv => `
      <tr>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb">#${inv.invoice_number}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb">${inv.client_name}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:600">${f(inv.total || 0)}</td>
      </tr>
    `)
    .join('');

  const maxDailyTotal = Math.max(...weeklyData.map(d => d.total), 1);
  
  const chartBars = weeklyData.map(day => {
    const percentage = (day.total / maxDailyTotal) * 100;
    const dateStr = day.date.toLocaleDateString('en-US', { weekday: 'short' });
    
    return `
      <div style="display:inline-block;width:13%;margin:0 1%;vertical-align:bottom;text-align:center">
        <div style="font-size:11px;font-weight:600;color:#111827;margin-bottom:4px">${f(day.total)}</div>
        ${day.isToday ? `<div style="background:#2563eb;color:white;padding:2px 4px;border-radius:3px;font-size:9px;margin-bottom:4px;display:inline-block">Today</div>` : `<div style="height:20px"></div>`}
        <div style="background:#f3f4f6;height:100px;border-radius:4px;position:relative;margin:0 auto;width:30px">
          <div style="position:absolute;bottom:0;left:0;right:0;background:${day.isToday ? '#3b82f6' : '#d1d5db'};height:${Math.max(percentage, 3)}%;border-radius:4px"></div>
        </div>
        <div style="font-size:10px;color:${day.isToday ? '#2563eb' : '#6b7280'};margin-top:4px;font-weight:${day.isToday ? '600' : '400'}">${dateStr}</div>
      </div>
    `;
  }).join('');
  
  const chartHTML = `
    <div style="text-align:center;padding:20px 0;white-space:nowrap">
      ${chartBars}
    </div>
  `;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<style>
@media only screen and (max-width:600px){
.email-container{max-width:100%!important}
.email-body{padding:10px!important}
.email-content{padding:10px!important}
}
</style>
</head>
<body style="margin:0;padding:20px;font-family:Arial,sans-serif">
<div class="email-container" style="max-width:600px;margin:0 auto">

<div class="email-body" style="text-align:center;padding:15px;background:#1e3a8a;color:white">
<h1 style="margin:0;font-size:22px">${companyName}, your daily sales report.</h1>
<p style="margin:5px 0">${today.toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'})}</p>
</div>

<div class="email-content" style="padding:15px">

<div style="margin-bottom:20px">
<table cellpadding="0" cellspacing="0" style="width:100%">
<tr>
<td style="width:48%;padding:10px;background:linear-gradient(135deg,#86efac,#6ee7b7);border-radius:5px;text-align:center">
<div style="color:rgba(0,0,0,0.7);font-size:11px;text-transform:uppercase;letter-spacing:0.5px">Total Sales</div>
<div style="color:#065f46;font-size:24px;font-weight:700;margin-top:4px">${f(totalSales)}</div>
</td>
<td style="width:4%"></td>
<td style="width:48%;padding:10px;background:linear-gradient(135deg,#a5b4fc,#93c5fd);border-radius:5px;text-align:center">
<div style="color:rgba(0,0,0,0.7);font-size:11px;text-transform:uppercase;letter-spacing:0.5px">Invoices Paid</div>
<div style="color:#1e40af;font-size:24px;font-weight:700;margin-top:4px">${invoices.length}</div>
</td>
</tr>
</table>
</div>

<h3 style="color:#1e3a8a;margin:25px 0 10px 0">Weekly Overview</h3>
<div style="border-top:1px solid #1e3a8a;margin-bottom:18px"></div>
${chartHTML}

<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Today's Invoices</h3>
<div style="border-top:1px solid #1e3a8a;margin-bottom:12px"></div>
<table cellpadding="0" cellspacing="0" style="width:100%;border:1px solid #e5e7eb;border-radius:5px">
<thead>
<tr style="background:#f9fafb">
<th style="padding:10px;text-align:left;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;border-bottom:2px solid #e5e7eb">Invoice</th>
<th style="padding:10px;text-align:left;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;border-bottom:2px solid #e5e7eb">Client</th>
<th style="padding:10px;text-align:right;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;border-bottom:2px solid #e5e7eb">Amount</th>
</tr>
</thead>
<tbody>
${invoiceListHTML}
</tbody>
</table>

</div>

<div style="text-align:center;padding:15px;background:#1e3a8a;color:white">
<p style="margin:0 0 5px 0;font-size:12px">Service provided by</p>
<p style="margin:0;font-size:11px">© 2024 Thunder Pro Inc. | <a href="https://www.thunderpro.co" style="color:white;text-decoration:none">www.thunderpro.co</a></p>
</div>

</div>
</body>
</html>`;
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { email, emailType } = await req.json();
    
    // Handle daily sales report sample
    if (emailType === 'daily-sales-report') {
      console.log('📊 Sending SAMPLE daily sales report...');
      
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const lastSunday = new Date(today);
      const dayOfWeek = today.getDay();
      lastSunday.setDate(today.getDate() - dayOfWeek);
      
      const weekDays = [];
      for (let i = 0; i < 7; i++) {
        const date = new Date(lastSunday);
        date.setDate(lastSunday.getDate() + i);
        weekDays.push(date);
      }
      
      const sampleWeeklyData = weekDays.map((date, index) => {
        const dateStr = date.toDateString();
        const todayStr = today.toDateString();
        const isToday = dateStr === todayStr;
        
        let total = 0;
        if (index === 0) total = 850.00;
        else if (index === 1) total = 1250.00;
        else if (index === 2) total = 1400.00;
        else if (index === 3) total = 980.00;
        else if (index === 4) total = 1650.00;
        else if (index === 5) total = 1820.00;
        else if (index === 6) total = 750.00;
        
        if (isToday) total = 2150.00;
        
        return { date, total, isToday };
      });
      
      const sampleInvoices = [
        { invoice_number: 'INV-2024-001', client_name: 'ABC Cleaning Corp', total: 850.00 },
        { invoice_number: 'INV-2024-002', client_name: 'XYZ Services LLC', total: 650.00 },
        { invoice_number: 'INV-2024-003', client_name: 'Clean Masters Inc', total: 650.00 },
      ];
      
      const totalSales = sampleInvoices.reduce((sum, inv) => sum + inv.total, 0);
      
      const emailHTML = generateSalesReportTemplate(
        sampleInvoices,
        totalSales,
        sampleWeeklyData,
        'Thunder Pro Sample'
      );
      
      await sendEmailViaSMTP(
        email || 'thunderprocompany@gmail.com',
        `Thunder Pro Sample —Your Daily Sales Summary Report`,
        emailHTML
      );
      
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: `Sample daily sales report sent to ${email || 'thunderprocompany@gmail.com'}`,
          details: {
            totalSales,
            invoiceCount: sampleInvoices.length,
            weekData: sampleWeeklyData.map(d => ({
              day: d.date.toLocaleDateString('en-US', { weekday: 'short' }),
              total: d.total,
              isToday: d.isToday
            }))
          }
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Client Payment Confirmation - Same design as estimates
    const clientPaymentHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
@media only screen and (max-width: 600px) {
  .email-container { max-width: 100% !important; }
  .email-body { padding: 10px !important; }
  .email-content { padding: 10px !important; }
}
</style>
</head>
<body style="margin:0;padding:20px;font-family:Arial,sans-serif">
<div class="email-container" style="max-width:600px;margin:0 auto">

<div class="email-body" style="text-align:center;padding:15px;background:#10b981;color:white">
<div style="font-size:48px;margin:10px 0">✓</div>
<h1 style="margin:0;font-size:22px">Payment Successful</h1>
<p style="margin:5px 0">Thank you for your payment</p>
</div>

<div class="email-content" style="padding:15px">

<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Payment Confirmation</h3>
<div style="border-top:1px solid #1e3a8a;margin-bottom:12px"></div>
<p>Hello Fernando Jimenez,</p>
<p>Your payment to <strong>Clean Up Company LLC</strong> has been successfully processed.</p>

<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Payment Details</h3>
<table cellpadding="0" cellspacing="0" style="width:100%;background-color:#f0fdf4">
  <tr>
    <td style="padding:16px">
      <table cellpadding="0" cellspacing="0" style="width:100%">
        <tr>
          <td style="padding:8px 0;text-align:left">Invoice Number:</td>
          <td style="padding:8px 0;text-align:right">INV-2025-003</td>
        </tr>
        <tr>
          <td style="padding:8px 0;text-align:left">Payment Date:</td>
          <td style="padding:8px 0;text-align:right">11/5/2025</td>
        </tr>
        <tr>
          <td style="padding:8px 0;text-align:left">Payment Method:</td>
          <td style="padding:8px 0;text-align:right">Online</td>
        </tr>
        <tr>
          <td style="padding:12px 0 0 0;text-align:left;font-weight:bold;font-size:20px;color:#10b981;border-top:1px solid #d1d5db">Amount Paid:</td>
          <td style="padding:12px 0 0 0;text-align:right;font-weight:bold;font-size:20px;color:#10b981;border-top:1px solid #d1d5db">$150.00</td>
        </tr>
      </table>
    </td>
  </tr>
</table>

<div style="background:#eff6ff;border-left:4px solid #3b82f6;padding:12px;margin:20px 0">
<p style="margin:0;font-size:13px;color:#1e40af">💡 A receipt has been generated for your records. If you need any assistance, please contact us.</p>
</div>

<p style="margin-top:20px;font-size:13px;color:#6c757d">Thank you for choosing Clean Up Company LLC. We appreciate your business!</p>

</div>

<div style="text-align:center;padding:15px;background:#1e3a8a;color:white">
<p style="margin:0 0 5px 0;font-size:12px">Service provided by</p>
<p style="margin:0">© 2024 Thunder Pro Inc. | <a href="https://www.thunderpro.co" style="color:white">www.thunderpro.co</a></p>
</div>

</div>
</body>
</html>`;

    // Owner Payment Notification - Same design as estimates
    const ownerPaymentHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
@media only screen and (max-width: 600px) {
  .email-container { max-width: 100% !important; }
  .email-body { padding: 10px !important; }
  .email-content { padding: 10px !important; }
}
</style>
</head>
<body style="margin:0;padding:20px;font-family:Arial,sans-serif">
<div class="email-container" style="max-width:600px;margin:0 auto">

<div class="email-body" style="text-align:center;padding:15px;background:#1e3a8a;color:white">
<p style="margin:0;font-size:14px;font-weight:bold;background:#1e40af;padding:8px;border-radius:4px">OWNER COPY - INTERNAL USE ONLY</p>
<div style="font-size:48px;margin:10px 0">💰</div>
<h1 style="margin:0;font-size:22px">Payment Received</h1>
<p style="margin:5px 0">Invoice has been paid</p>
</div>

<div class="email-content" style="padding:15px">

<div style="background:#f0fdf4;padding:12px;border-left:4px solid #10b981;margin-bottom:15px">
<p style="margin:0;font-weight:bold;color:#059669">Payment Successfully Received</p>
<p style="margin:5px 0 0 0;font-size:13px">Fernando Jimenez has just paid an invoice</p>
</div>

<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Client Information</h3>
<div style="border-top:1px solid #1e3a8a;margin-bottom:12px"></div>
<p><strong>Name:</strong> Fernando Jimenez<br>
<strong>Email:</strong> info@cleanersup.com<br>
<strong>Invoice Number:</strong> INV-2025-003</p>

<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Payment Details</h3>
<table cellpadding="0" cellspacing="0" style="width:100%;background-color:#f0fdf4">
  <tr>
    <td style="padding:16px">
      <table cellpadding="0" cellspacing="0" style="width:100%">
        <tr>
          <td style="padding:8px 0;text-align:left">Payment Date:</td>
          <td style="padding:8px 0;text-align:right">11/5/2025</td>
        </tr>
        <tr>
          <td style="padding:8px 0;text-align:left">Payment Method:</td>
          <td style="padding:8px 0;text-align:right">Online</td>
        </tr>
        <tr>
          <td style="padding:12px 0 0 0;text-align:left;font-weight:bold;font-size:20px;color:#1e3a8a;border-top:1px solid #d1d5db">Amount Received:</td>
          <td style="padding:12px 0 0 0;text-align:right;font-weight:bold;font-size:20px;color:#1e3a8a;border-top:1px solid #d1d5db">$150.00</td>
        </tr>
      </table>
    </td>
  </tr>
</table>

<div style="background:#eff6ff;border-left:4px solid #3b82f6;padding:12px;margin:20px 0">
<p style="margin:0;font-size:13px;color:#1e40af">💡 The invoice status has been updated to "Paid" in your system.</p>
</div>

</div>

<div style="text-align:center;padding:15px;background:#1e3a8a;color:white">
<p style="margin:0 0 5px 0;font-size:12px">Service provided by</p>
<p style="margin:0">© 2024 Thunder Pro Inc. | <a href="https://www.thunderpro.co" style="color:white">www.thunderpro.co</a></p>
</div>

</div>
</body>
</html>`;

    console.log('Sending payment sample emails to:', email);

    await sendEmailViaSMTP(
      email,
      'Sample - Payment Confirmation for Client',
      clientPaymentHtml
    );

    console.log('Client payment sample sent');

    await sendEmailViaSMTP(
      email,
      'Sample - Payment Notification for Owner',
      ownerPaymentHtml
    );

    console.log('Owner payment sample sent');

    return new Response(
      JSON.stringify({ success: true, message: 'Payment sample emails sent' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('Error sending payment sample emails:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
