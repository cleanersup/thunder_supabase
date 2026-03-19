import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const formatDate = (dateStr: string): string => {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { 
    weekday: 'long', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });
};

const formatTime = (timeStr: string): string => {
  const [hours, minutes] = timeStr.split(':');
  const hour = parseInt(hours, 10);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${minutes} ${ampm}`;
};

// Owner email template
const generateOwnerEmailTemplate = (walkthrough: any, contactInfo: any, companyInfo: any): string => {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:20px;font-family:Arial,sans-serif">
<div style="max-width:600px;margin:0 auto">

<div style="text-align:center;padding:15px;background:#1e3a8a;color:white">
  <p style="margin:0;font-size:14px;font-weight:bold;background:#1e40af;padding:8px;border-radius:4px">OWNER COPY - INTERNAL USE ONLY</p>
  <h1 style="margin:10px 0 0 0;font-size:22px">${companyInfo.company_name || 'Thunder Pro'}</h1>
  <p style="margin:5px 0">Walkthrough In Progress</p>
</div>

<div style="padding:15px">

<div style="background:#dcfce7;border-left:4px solid #10b981;padding:12px;margin:20px 0">
<p style="margin:0;font-size:14px;font-weight:bold;color:#065f46">🎉 Good news! The walkthrough has started!!</p>
</div>

<p>Your team has begun the walkthrough process. Here are the details:</p>

<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Walkthrough Information</h3>
<div style="border-top:1px solid #1e3a8a;margin-bottom:12px"></div>
<p>
<strong>Service Type:</strong> ${walkthrough.service_type}<br>
<strong>Date:</strong> ${formatDate(walkthrough.scheduled_date)}<br>
<strong>Time:</strong> ${formatTime(walkthrough.scheduled_time)}
</p>

<h3 style="color:#1e3a8a;margin:20px 0 8px 0">${walkthrough.walkthrough_type === 'client' ? 'Client' : 'Lead'} Information</h3>
<div style="border-top:1px solid #1e3a8a;margin-bottom:12px"></div>
<p>
<strong>Name:</strong> ${contactInfo.full_name}<br>
<strong>Phone:</strong> ${contactInfo.phone}<br>
<strong>Email:</strong> ${contactInfo.email}<br>
<strong>Address:</strong> ${contactInfo.service_street}, ${contactInfo.service_city}, ${contactInfo.service_state} ${contactInfo.service_zip} <a href="https://maps.google.com/?q=${encodeURIComponent(contactInfo.service_street + ', ' + contactInfo.service_city + ', ' + contactInfo.service_state + ' ' + contactInfo.service_zip)}" style="display:inline-block;background:#3b82f6;color:white;padding:4px 10px;text-decoration:none;border-radius:4px;font-size:12px;margin-left:8px">📍 Navigate</a>
</p>

<div style="background:#eff6ff;border-left:4px solid #3b82f6;padding:12px;margin:20px 0">
<p style="margin:0;font-size:13px;color:#1e40af">📋 This walkthrough will help you prepare an accurate estimate for your client.</p>
</div>

<p>Keep up the great work! 💪</p>

</div>

<div style="text-align:center;padding:15px;background:#1e3a8a;color:white">
  <p style="margin:0 0 5px 0;font-size:12px">Service provided by</p>
  <p style="margin:0">© 2024 Thunder Pro Inc. | <a href="https://www.thunderpro.co" style="color:white">www.thunderpro.co</a></p>
</div>

</div>
</body>
</html>`;
};

// Client/Lead email template
const generateClientEmailTemplate = (walkthrough: any, contactInfo: any, companyInfo: any): string => {
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
  <p style="margin:5px 0">Exciting News!</p>
</div>

<div style="padding:15px">

<p style="font-size:16px;color:#1e3a8a">Dear ${contactInfo.full_name},</p>

<div style="background:#dcfce7;border-left:4px solid #10b981;padding:12px;margin:20px 0">
<p style="margin:0;font-size:14px;font-weight:bold;color:#065f46">🎉 Good news! The walkthrough has started!!</p>
</div>

<p>Our team has just begun your walkthrough appointment. We're excited to assess your space and provide you with the best service possible!</p>

<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Appointment Details</h3>
<div style="border-top:1px solid #1e3a8a;margin-bottom:12px"></div>
<p>
<strong>Service Type:</strong> ${walkthrough.service_type}<br>
<strong>Date:</strong> ${formatDate(walkthrough.scheduled_date)}<br>
<strong>Time:</strong> ${formatTime(walkthrough.scheduled_time)}
</p>

<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Location</h3>
<div style="border-top:1px solid #1e3a8a;margin-bottom:12px"></div>
<p>${contactInfo.service_street}<br>
${contactInfo.service_city}, ${contactInfo.service_state} ${contactInfo.service_zip}</p>

<div style="background:#eff6ff;border-left:4px solid #3b82f6;padding:12px;margin:20px 0">
<p style="margin:0;font-size:13px;color:#1e40af">📞 If you have any questions or concerns during the walkthrough, please don't hesitate to contact us at ${companyInfo.company_phone || companyInfo.company_email || 'our office'}.</p>
</div>

<p>Thank you for choosing ${companyInfo.company_name || 'Thunder Pro'}!</p>

</div>

<div style="text-align:center;padding:15px;background:#1e3a8a;color:white">
  <p style="margin:0 0 5px 0;font-size:12px">Service provided by</p>
  <p style="margin:0">© 2024 Thunder Pro Inc. | <a href="https://www.thunderpro.co" style="color:white">www.thunderpro.co</a></p>
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

    if (!email) {
      throw new Error('Email is required');
    }

    console.log('📋 Sending sample walkthrough start emails to:', email);

    const walkthrough = {
      service_type: 'Residential Cleaning',
      scheduled_date: '2025-01-15',
      scheduled_time: '10:00',
      walkthrough_type: 'client',
    };

    const contactInfo = {
      full_name: 'John Smith',
      phone: '(555) 123-4567',
      email: 'john.smith@example.com',
      service_street: '123 Main Street',
      service_city: 'Los Angeles',
      service_state: 'CA',
      service_zip: '90001',
    };

    const companyInfo = {
      company_name: 'Thunder Pro Cleaning Services',
      company_email: 'info@thunderpro.co',
      company_phone: '(555) 999-8888',
    };

    // Send owner email
    const ownerEmailHtml = generateOwnerEmailTemplate(walkthrough, contactInfo, companyInfo);
    await sendEmailViaSMTP(
      email,
      '[SAMPLE] Good news, the walkthrough has started !! - Owner Version',
      ownerEmailHtml
    );
    console.log('Owner sample email sent');

    // Send client email
    const clientEmailHtml = generateClientEmailTemplate(walkthrough, contactInfo, companyInfo);
    await sendEmailViaSMTP(
      email,
      '[SAMPLE] Good news, the walkthrough has started !! - Client Version',
      clientEmailHtml
    );
    console.log('Client sample email sent');

    return new Response(
      JSON.stringify({ success: true, message: 'Sample emails sent successfully' }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );

  } catch (error: any) {
    console.error('Error in send-start-walkthrough-samples:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
};

serve(handler);
