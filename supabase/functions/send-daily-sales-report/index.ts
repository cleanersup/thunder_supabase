import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

// Optimized SMTP implementation (same as send-estimate-email)
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

  console.log('Configuration:', {
    smtpHost,
    smtpPort,
    fromEmail,
    toEmail,
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

    await sendCommand(tlsConn, 'DATA', '[9/10]');

    // Build email in chunks to avoid memory issues
    console.log('[9/10] Sending email headers...');
    
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
      `X-Mailer: ThunderPro-Reports`,
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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    console.log('Checking for paid invoices today...');

    // Get invoices paid TODAY only (use paid_date instead of updated_at)
    const { data: paidInvoices, error: invoicesError } = await supabase
      .from('invoices')
      .select('*')
      .eq('status', 'Paid')
      .gte('paid_date', today.toISOString().split('T')[0])
      .lt('paid_date', tomorrow.toISOString().split('T')[0])
      .not('user_id', 'is', null)
      .order('paid_date', { ascending: false });

    if (invoicesError) {
      console.error('Error fetching invoices:', invoicesError);
      throw invoicesError;
    }

    console.log(`Found ${paidInvoices?.length || 0} paid invoices today`);

    if (!paidInvoices || paidInvoices.length === 0) {
      console.log('No paid invoices found today');
      return new Response(
        JSON.stringify({ message: 'No paid invoices found today' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Group invoices by user_id to send one email per business owner
    const invoicesByUser = paidInvoices.reduce((acc: Record<string, any[]>, invoice: any) => {
      if (!acc[invoice.user_id]) {
        acc[invoice.user_id] = [];
      }
      acc[invoice.user_id].push(invoice);
      return acc;
    }, {} as Record<string, any[]>);

    const emailsSent: any[] = [];

    // Send one email per business owner with all their invoices from today
    for (const [userId, userInvoices] of Object.entries(invoicesByUser)) {
      const typedInvoices = userInvoices as any[];
      console.log(`Processing ${typedInvoices.length} invoices for user ${userId}`);

      // Get user profile  
      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      const userEmail = profile?.email || profile?.company_email;
      
      if (!userEmail) {
        console.log(`No email found for user ${userId}, skipping...`);
        continue;
      }

      const companyName = profile?.company_name || 'Thunder Pro';
      console.log(`Will send email to: ${userEmail}`);

      // Calculate totals for this user
      const totalSales = typedInvoices.reduce((sum: number, inv: any) => sum + (inv.total || 0), 0);

      // Get last 7 days sales data for chart (Sunday to Today)
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      // Get the most recent Sunday (start of week)
      const lastSunday = new Date(today);
      const dayOfWeek = today.getDay(); // 0 = Sunday, 6 = Saturday
      lastSunday.setDate(today.getDate() - dayOfWeek);
      
      // Build array from Sunday to Saturday (7 days)
      const weekDays = [];
      for (let i = 0; i < 7; i++) {
        const date = new Date(lastSunday);
        date.setDate(lastSunday.getDate() + i);
        weekDays.push(date);
      }

      const { data: weekInvoices } = await supabase
        .from('invoices')
        .select('total, paid_date')
        .eq('user_id', userId)
        .eq('status', 'Paid')
        .gte('paid_date', lastSunday.toISOString().split('T')[0]);

      const dailyTotals = weekDays.map(date => {
        const nextDay = new Date(date);
        nextDay.setDate(nextDay.getDate() + 1);
        
        const dayTotal = (weekInvoices || [])
          .filter(inv => {
            const invDate = new Date(inv.paid_date);
            return invDate >= date && invDate < nextDay;
          })
          .reduce((sum, inv) => sum + (inv.total || 0), 0);
        
        const dateStr = date.toDateString();
        const todayStr = today.toDateString();
        
        return {
          date,
          total: dayTotal,
          isToday: dateStr === todayStr
        };
      });

      // Generate email HTML
      const emailHTML = generateSalesReportTemplate(
        typedInvoices,
        totalSales,
        dailyTotals,
        companyName
      );

      // Send email
      await sendEmailViaSMTP(
        userEmail,
        `${companyName} —Your Daily Sales Summary Report`,
        emailHTML
      );

      emailsSent.push({ userId, email: userEmail, invoiceCount: typedInvoices.length, totalSales });
      console.log(`Sales report sent to ${userEmail}`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Sent ${emailsSent.length} sales report(s)`,
        details: emailsSent
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Error in send-daily-sales-report:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
