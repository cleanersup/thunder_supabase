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

const generateOwnerEmailTemplate = (walkthrough: any, contactInfo: any, companyInfo: any): string => {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Walkthrough Completed</title>
</head>
<body style="margin:0;padding:20px;font-family:Arial,sans-serif">

<div style="max-width:600px;margin:0 auto">

<div style="text-align:center;padding:15px;background:#7c3aed;color:white">
  <h1 style="margin:0;font-size:22px">${companyInfo.company_name || 'Company Name'} - Thunder Pro System</h1>
  <p style="margin:5px 0">🎉 Walkthrough Completed!</p>
</div>

<div style="background:white;padding:25px">

<p style="font-size:15px;line-height:1.6;margin:0 0 20px">
  Hello ${companyInfo.company_name || 'Team'},
</p>

<div style="background:#f3e8ff;border-left:4px solid #7c3aed;padding:15px;margin:20px 0">
<p style="margin:0;font-size:14px;color:#5b21b6;font-weight:600">
🎊 Congratulations on completing a Walkthrough with Thunder Pro System!
</p>
</div>

<p style="font-size:14px;line-height:1.6;margin:15px 0">
  It's time to go to the office and work on that estimate. We wish you the best of luck and hope that contract gets approved! 🍀
</p>

<div style="background:#f8fafc;padding:15px;border-radius:8px;margin:20px 0">
  <h2 style="margin:0 0 12px;font-size:16px;color:#1e293b">Client/Lead Information</h2>
  
  <table style="width:100%;border-collapse:collapse">
    <tr>
      <td style="padding:8px 0;font-size:13px;color:#64748b">Name:</td>
      <td style="padding:8px 0;font-size:13px;font-weight:600">${contactInfo.full_name || 'N/A'}</td>
    </tr>
    ${contactInfo.company ? `
    <tr>
      <td style="padding:8px 0;font-size:13px;color:#64748b">Company:</td>
      <td style="padding:8px 0;font-size:13px;font-weight:600">${contactInfo.company}</td>
    </tr>` : ''}
    <tr>
      <td style="padding:8px 0;font-size:13px;color:#64748b">Phone:</td>
      <td style="padding:8px 0;font-size:13px;font-weight:600">${contactInfo.phone || 'N/A'}</td>
    </tr>
    <tr>
      <td style="padding:8px 0;font-size:13px;color:#64748b">Email:</td>
      <td style="padding:8px 0;font-size:13px;font-weight:600">${contactInfo.email || 'N/A'}</td>
    </tr>
    <tr>
      <td style="padding:8px 0;font-size:13px;color:#64748b">Service Type:</td>
      <td style="padding:8px 0;font-size:13px;font-weight:600">${walkthrough.service_type || 'N/A'}</td>
    </tr>
    <tr>
      <td style="padding:8px 0;font-size:13px;color:#64748b">Address:</td>
      <td style="padding:8px 0;font-size:13px;font-weight:600">
        ${contactInfo.service_street || ''}<br>
        ${contactInfo.service_city || ''}, ${contactInfo.service_state || ''} ${contactInfo.service_zip || ''}
      </td>
    </tr>
  </table>
</div>

<div style="background:#dcfce7;border-left:4px solid #16a34a;padding:12px;margin:20px 0">
<p style="margin:0;font-size:13px;color:#166534">
💪 Keep it up! The client is waiting for your professional proposal.
</p>
</div>

<p style="font-size:14px;line-height:1.6;margin:20px 0">
  Best regards,<br>
  Thunder Pro System Team
</p>

</div>

<div style="text-align:center;padding:15px;background:#7c3aed;color:white">
<p style="margin:0 0 5px 0;font-size:12px">Service provided by</p>
<p style="margin:0">© ${new Date().getFullYear()} Thunder Pro Inc. | <a href="https://www.thunderpro.co" style="color:white">www.thunderpro.co</a></p>
</div>

</div>

</body>
</html>`;
};

const generateClientEmailTemplate = (walkthrough: any, contactInfo: any, companyInfo: any): string => {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Walkthrough Completed</title>
</head>
<body style="margin:0;padding:20px;font-family:Arial,sans-serif">

<div style="max-width:600px;margin:0 auto">

<div style="text-align:center;padding:15px;background:#1e3a8a;color:white">
  <h1 style="margin:0;font-size:22px">${companyInfo.company_name || 'Company Name'}</h1>
  <p style="margin:5px 0">Thank You!</p>
</div>

<div style="background:white;padding:25px">

<p style="font-size:15px;line-height:1.6;margin:0 0 20px">
  Hello ${contactInfo.full_name || 'there'},
</p>

<div style="background:#dbeafe;border-left:4px solid #3b82f6;padding:15px;margin:20px 0">
<p style="margin:0;font-size:14px;color:#1e40af;font-weight:600">
✅ Your walkthrough has been completed successfully!
</p>
</div>

<p style="font-size:14px;line-height:1.6;margin:15px 0">
  Thank you for allowing our team to assess your space. We're now working on preparing your personalized estimate.
</p>

<div style="background:#fef3c7;border-left:4px solid #f59e0b;padding:15px;margin:20px 0">
<p style="margin:0;font-size:14px;color:#92400e;font-weight:600">
📬 You will receive your detailed estimate within the next 24 hours via email.
</p>
</div>

<div style="background:#f8fafc;padding:15px;border-radius:8px;margin:20px 0">
  <h2 style="margin:0 0 12px;font-size:16px;color:#1e293b">Walkthrough Details</h2>
  
  <table style="width:100%;border-collapse:collapse">
    <tr>
      <td style="padding:8px 0;font-size:13px;color:#64748b">Service Type:</td>
      <td style="padding:8px 0;font-size:13px;font-weight:600">${walkthrough.service_type || 'N/A'}</td>
    </tr>
    <tr>
      <td style="padding:8px 0;font-size:13px;color:#64748b">Location:</td>
      <td style="padding:8px 0;font-size:13px;font-weight:600">
        ${contactInfo.service_street || ''}<br>
        ${contactInfo.service_city || ''}, ${contactInfo.service_state || ''} ${contactInfo.service_zip || ''}
      </td>
    </tr>
  </table>
</div>

<div style="background:#eff6ff;border-left:4px solid #3b82f6;padding:12px;margin:20px 0">
<p style="margin:0;font-size:13px;color:#1e40af">
📞 If you have any questions in the meantime, please don't hesitate to contact us at ${companyInfo.company_phone || 'Company Phone Number'}.
</p>
</div>

<p style="font-size:14px;line-height:1.6;margin:20px 0">
  We appreciate your interest in ${companyInfo.company_name || 'Company Name'} and look forward to serving you!
</p>

</div>

<div style="text-align:center;padding:15px;background:#1e3a8a;color:white">
<p style="margin:0 0 5px 0;font-size:12px">Service provided by</p>
<p style="margin:0">© ${new Date().getFullYear()} Thunder Pro Inc. | <a href="https://www.thunderpro.co" style="color:white">www.thunderpro.co</a></p>
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

    console.log('📋 Sending sample walkthrough completion emails to:', email);

    const walkthrough = {
      service_type: 'Residential Cleaning',
      scheduled_date: '2025-01-15',
      scheduled_time: '10:00',
      walkthrough_type: 'client',
    };

    const contactInfo = {
      full_name: 'John Smith',
      company: 'Smith Properties LLC',
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
      '[SAMPLE] Congratulations! Walkthrough Completed - Owner Version',
      ownerEmailHtml
    );
    console.log('Owner sample email sent');

    // Send client email
    const clientEmailHtml = generateClientEmailTemplate(walkthrough, contactInfo, companyInfo);
    await sendEmailViaSMTP(
      email,
      '[SAMPLE] Your Estimate is Being Prepared - Client Version',
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
    console.error('Error in send-completion-walkthrough-samples:', error);
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
