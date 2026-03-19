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

// Owner cancellation email template
const generateOwnerCancellationEmail = (): string => {
  const walkthrough = {
    scheduled_date: '2024-11-15',
    scheduled_time: '10:00:00',
    service_type: 'residential',
    walkthrough_type: 'client'
  };
  
  const contactInfo = {
    full_name: 'John Smith',
    service_street: '123 Main Street',
    service_apt: 'Apt 4B',
    service_city: 'Miami',
    service_state: 'FL',
    service_zip: '33101',
    phone: '(305) 555-0123'
  };
  
  const companyInfo = {
    company_name: 'Company Name'
  };
  
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:20px;font-family:Arial,sans-serif">
<div style="max-width:600px;margin:0 auto">

<div style="text-align:center;padding:15px;background:#dc2626;color:white">
  <h1 style="margin:0;font-size:22px">${companyInfo.company_name}</h1>
  <p style="margin:5px 0">Walkthrough Cancelled</p>
</div>

<div style="padding:15px">

<p style="font-size:16px;color:#1e3a8a">Hi,</p>

<div style="background:#fee2e2;border-left:4px solid #dc2626;padding:12px;margin:20px 0">
<p style="margin:0;font-size:16px;font-weight:bold;color:#7f1d1d">❌ Walkthrough has been cancelled</p>
</div>

<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Cancelled Walkthrough Details</h3>
<div style="border-top:1px solid #1e3a8a;margin-bottom:12px"></div>
<p>
<strong>Date:</strong> ${formatDate(walkthrough.scheduled_date)}<br>
<strong>Time:</strong> ${formatTime(walkthrough.scheduled_time)}<br>
<strong>Service Type:</strong> ${walkthrough.service_type === 'residential' ? 'Residential' : 'Commercial'}<br>
<strong>${walkthrough.walkthrough_type === 'client' ? 'Client' : 'Lead'}:</strong> ${contactInfo.full_name}
</p>

<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Location</h3>
<div style="border-top:1px solid #1e3a8a;margin-bottom:12px"></div>
<p>
${contactInfo.service_street}${contactInfo.service_apt ? `, ${contactInfo.service_apt}` : ''}<br>
${contactInfo.service_city}, ${contactInfo.service_state} ${contactInfo.service_zip}<br>
<strong>Phone:</strong> ${contactInfo.phone}
</p>

<div style="background:#eff6ff;border-left:4px solid #3b82f6;padding:12px;margin:20px 0">
<p style="margin:0;font-size:13px;color:#1e40af">💡 You can reschedule this walkthrough anytime from your dashboard.</p>
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

// Client/Lead cancellation email template
const generateContactCancellationEmail = (): string => {
  const walkthrough = {
    scheduled_date: '2024-11-15',
    scheduled_time: '10:00:00',
    service_type: 'residential'
  };
  
  const contactInfo = {
    full_name: 'John Smith',
    service_street: '123 Main Street',
    service_apt: 'Apt 4B',
    service_city: 'Miami',
    service_state: 'FL',
    service_zip: '33101'
  };
  
  const companyInfo = {
    company_name: 'Company Name',
    company_phone: 'Company Phone Number'
  };
  
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:20px;font-family:Arial,sans-serif">
<div style="max-width:600px;margin:0 auto">

<div style="text-align:center;padding:15px;background:#1e3a8a;color:white">
  <h1 style="margin:0;font-size:22px">${companyInfo.company_name}</h1>
  <p style="margin:5px 0">Appointment Update</p>
</div>

<div style="padding:15px">

<p style="font-size:16px;color:#1e3a8a">Dear ${contactInfo.full_name},</p>

<div style="background:#fee2e2;border-left:4px solid #dc2626;padding:12px;margin:20px 0">
<p style="margin:0;font-size:16px;font-weight:bold;color:#7f1d1d">Your walkthrough appointment has been cancelled</p>
</div>

<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Cancelled Appointment Details</h3>
<div style="border-top:1px solid #1e3a8a;margin-bottom:12px"></div>
<p>
<strong>Date:</strong> ${formatDate(walkthrough.scheduled_date)}<br>
<strong>Time:</strong> ${formatTime(walkthrough.scheduled_time)}<br>
<strong>Service Type:</strong> ${walkthrough.service_type === 'residential' ? 'Residential Cleaning' : 'Commercial Cleaning'}
</p>

<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Location</h3>
<div style="border-top:1px solid #1e3a8a;margin-bottom:12px"></div>
<p>
${contactInfo.service_street}${contactInfo.service_apt ? `, ${contactInfo.service_apt}` : ''}<br>
${contactInfo.service_city}, ${contactInfo.service_state} ${contactInfo.service_zip}
</p>

<h3 style="color:#1e3a8a;margin:20px 0 8px 0">What's Next?</h3>
<div style="border-top:1px solid #1e3a8a;margin-bottom:12px"></div>
<p style="color:#4b5563;line-height:1.8">
We apologize for any inconvenience this may cause. If you would like to reschedule your walkthrough, please don't hesitate to contact us. We're here to help!
</p>

<div style="background:#eff6ff;border-left:4px solid #3b82f6;padding:12px;margin:20px 0">
<p style="margin:0;font-size:13px;color:#1e40af">📞 To reschedule or if you have any questions, please call us at ${companyInfo.company_phone}.</p>
</div>

<p>We look forward to serving you soon!</p>

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
  console.log(`📧 Sending email to: ${toEmail}`);
  
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

    console.log(`✅ Email sent successfully to ${toEmail}`);

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
    const recipientEmail = 'javiers058@gmail.com';

    console.log('📧 Sending sample cancellation emails to:', recipientEmail);

    // Send owner sample
    await sendEmailViaSMTP(
      recipientEmail,
      'Sample: Owner Cancellation Email - Walkthrough Successfully Cancelled',
      generateOwnerCancellationEmail()
    );

    // Send client sample
    await sendEmailViaSMTP(
      recipientEmail,
      'Sample: Client Cancellation Email - Walkthrough Successfully Cancelled',
      generateContactCancellationEmail()
    );

    console.log('✅ Sample emails sent successfully');

    return new Response(
      JSON.stringify({ success: true, message: 'Sample emails sent successfully' }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      }
    );

  } catch (error: any) {
    console.error('❌ Error sending sample emails:', error);
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
