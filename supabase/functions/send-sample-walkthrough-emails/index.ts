import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Helper to format date
const formatDate = (dateStr: string) => {
  return new Date(dateStr).toLocaleDateString('en-US', { 
    weekday: 'long', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });
};

// Helper to format time
const formatTime = (timeStr: string) => {
  if (!timeStr) return 'Not specified';
  const [hours, minutes] = timeStr.split(':');
  const hour = parseInt(hours);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${minutes} ${ampm}`;
};

// Client/Lead confirmation email template
const generateContactConfirmationEmail = (walkthrough: any, contactInfo: any, companyInfo: any): string => {
  const contactName = contactInfo.full_name || contactInfo.lead_name;
  
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:20px;font-family:Arial,sans-serif">
<div style="max-width:600px;margin:0 auto">

<div style="text-align:center;padding:15px;background:#1e3a8a;color:white">
  <h1 style="margin:0;font-size:22px">${companyInfo.company_name || 'Thunder Pro'}</h1>
  <p style="margin:5px 0">Walkthrough Confirmation</p>
</div>

<div style="padding:15px">

<p style="font-size:16px;color:#1e3a8a">Dear ${contactName},</p>
<p>Thank you for scheduling a walkthrough with us! We're excited to visit your property and provide you with a detailed estimate.</p>

<div style="background:#dcfce7;border-left:4px solid #10b981;padding:12px;margin:20px 0">
<p style="margin:0;font-size:14px;font-weight:bold;color:#065f46">✅ Your walkthrough is confirmed</p>
</div>

<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Appointment Details</h3>
<div style="border-top:1px solid #1e3a8a;margin-bottom:12px"></div>
<p>
<strong>Date:</strong> ${formatDate(walkthrough.scheduled_date)}<br>
<strong>Time:</strong> ${formatTime(walkthrough.scheduled_time)}<br>
<strong>Service Type:</strong> ${walkthrough.service_type === 'residential' ? 'Residential Cleaning' : 'Commercial Cleaning'}
</p>

<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Location</h3>
<div style="border-top:1px solid #1e3a8a;margin-bottom:12px"></div>
<p>${contactInfo.service_street}${contactInfo.service_apt ? `, ${contactInfo.service_apt}` : ''}<br>
${contactInfo.service_city}, ${contactInfo.service_state} ${contactInfo.service_zip}</p>

<h3 style="color:#1e3a8a;margin:20px 0 8px 0">What to Expect</h3>
<div style="border-top:1px solid #1e3a8a;margin-bottom:12px"></div>
<p>During the walkthrough, our team will:</p>
<ul style="color:#4b5563;line-height:1.8">
  <li>Assess your property's cleaning needs</li>
  <li>Take necessary measurements and photos</li>
  <li>Answer any questions you may have</li>
  <li>Provide you with a detailed estimate</li>
</ul>

<div style="background:#eff6ff;border-left:4px solid #3b82f6;padding:12px;margin:20px 0">
<p style="margin:0;font-size:13px;color:#1e40af">📞 If you need to reschedule or have any questions, please contact us at ${companyInfo.company_phone || companyInfo.company_email || 'our office'}.</p>
</div>

<p>We look forward to serving you!</p>

</div>

<div style="text-align:center;padding:15px;background:#1e3a8a;color:white">
  <p style="margin:0">© 2024 ${companyInfo.company_name || 'Thunder Pro'}</p>
  ${companyInfo.company_phone ? `<p style="margin:5px 0 0 0;font-size:12px">${companyInfo.company_phone}</p>` : ''}
</div>

</div>
</body>
</html>`;
};

// SMTP Email Sending Function
async function sendEmailViaSMTP(
  toEmail: string,
  subject: string,
  htmlContent: string
): Promise<void> {
  console.log(`📧 Sending sample email to: ${toEmail}`);
  
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
      command: string
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
    await sendCommand(tlsConn, btoa(smtpUser));
    await sendCommand(tlsConn, btoa(smtpPass));
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

    console.log(`✅ Sample email sent successfully to ${toEmail}`);

  } catch (error: any) {
    console.error(`❌ SMTP Error sending to ${toEmail}:`, error.message);
    try {
      if (tlsConn) tlsConn.close();
      if (conn) conn.close();
    } catch {}
    throw error;
  }
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { email } = await req.json();

    console.log('📋 Sending sample walkthrough confirmation email to:', email);

    if (!email) {
      throw new Error('Email address is required');
    }

    // Sample walkthrough data
    const sampleWalkthrough = {
      scheduled_date: '2025-01-15',
      scheduled_time: '10:00',
      service_type: 'residential',
      status: 'Scheduled',
      duration: 60,
      notes: 'Please ensure access to all rooms including the basement.'
    };

    // Sample contact info
    const sampleContactInfo = {
      full_name: 'John Smith',
      email: email,
      phone: '(555) 123-4567',
      service_street: '123 Main Street',
      service_apt: 'Apt 4B',
      service_city: 'Los Angeles',
      service_state: 'CA',
      service_zip: '90001'
    };

    // Sample company info
    const sampleCompanyInfo = {
      company_name: 'Thunder Pro Cleaning Services',
      company_email: 'info@thunderpro.co',
      company_phone: '(555) 999-8888'
    };

    // Generate and send the email
    const htmlContent = generateContactConfirmationEmail(
      sampleWalkthrough,
      sampleContactInfo,
      sampleCompanyInfo
    );

    await sendEmailViaSMTP(
      email,
      '[SAMPLE] Your Walkthrough is Confirmed - Thunder Pro',
      htmlContent
    );

    console.log('✅ Sample email sent successfully');

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `Sample walkthrough confirmation email sent to ${email}` 
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      }
    );

  } catch (error: any) {
    console.error('❌ Error in send-sample-walkthrough-emails:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      }
    );
  }
};

serve(handler);
