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

    await sendCommand(tlsConn, btoa(smtpUser), '[7/10]', true);
    await sendCommand(tlsConn, btoa(smtpPass), '[7/10]', true);
    console.log('[7/10] ✓ Authentication successful');

    await sendCommand(tlsConn, `MAIL FROM:<info@thunderpro.co>`, '[8/10]');
    await sendCommand(tlsConn, `RCPT TO:<${toEmail}>`, '[8/10]');

    await sendCommand(tlsConn, 'DATA', '[9/10]');

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
    const { email } = await req.json();

    // Client Invoice Email - Same design as estimates
    const clientInvoiceHtml = `<!DOCTYPE html>
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
<h1 style="margin:0;font-size:22px">Clean Up Company LLC</h1>
<p style="margin:5px 0">Professional Cleaning Invoice</p>
</div>

<div class="email-content" style="padding:15px">

<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Client Information</h3>
<div style="border-top:1px solid #1e3a8a;margin-bottom:12px"></div>
<p><strong>Name:</strong> Fernando Jimenez<br>
<strong>Email:</strong> info@cleanersup.com<br>
<strong>Phone:</strong> (626) 555-0123<br>
<strong>Address:</strong> 818 w huntington dr, Arcadia, CA 91007</p>

<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Invoice Details</h3>
<div style="border-top:1px solid #1e3a8a;margin-bottom:12px"></div>
<p><strong>Invoice Number:</strong> INV-2025-003<br>
<strong>Invoice Date:</strong> 10/26/2025<br>
<strong>Due Date:</strong> 10/31/2025<br>
<strong>Service Type:</strong> Single</p>

<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Notes</h3>
<div style="border-top:1px solid #1e3a8a;margin-bottom:12px"></div>
<p>Move-in / move-out cleaning.<br><br>Post-construction or renovation cleaning.<br><br>Deep cleaning before or after an event.</p>

<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Amount Due</h3>
<table cellpadding="0" cellspacing="0" style="width:100%;background-color:#f0fdf4">
  <tr>
    <td style="padding:16px">
      <table cellpadding="0" cellspacing="0" style="width:100%">
        <tr>
          <td style="padding:12px 0 0 0;text-align:left;font-weight:bold;font-size:20px;color:#1e3a8a">Total Amount Due:</td>
          <td style="padding:12px 0 0 0;text-align:right;font-weight:bold;font-size:20px;color:#1e3a8a">$150.00</td>
        </tr>
      </table>
    </td>
  </tr>
</table>

<div style="text-align:center;margin:30px 0">
<a href="#" style="display:inline-block;background:#10b981;color:white;padding:15px 40px;text-decoration:none;border-radius:5px;font-weight:bold;margin:10px">Pay Invoice</a>
</div>

<div style="background:#eff6ff;border-left:4px solid #3b82f6;padding:12px;margin:20px 0">
<p style="margin:0;font-size:13px;color:#1e40af">💡 To download a PDF copy, please log into your Thunder Pro account and navigate to the Invoices section.</p>
</div>

</div>

<div style="text-align:center;padding:15px;background:#1e3a8a;color:white">
<p style="margin:0 0 5px 0;font-size:12px">Service provided by</p>
<p style="margin:0">© 2024 Thunder Pro Inc. | <a href="https://www.thunderpro.co" style="color:white">www.thunderpro.co</a></p>
</div>

</div>
</body>
</html>`;

    // Owner Notification Email - Same design as estimates
    const ownerNotificationHtml = `<!DOCTYPE html>
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
<h1 style="margin:10px 0 0 0;font-size:22px">Clean Up Company LLC</h1>
<p style="margin:5px 0">Invoice Sent Confirmation</p>
</div>

<div class="email-content" style="padding:15px">

<div style="background:#f0fdf4;padding:12px;border-left:4px solid #10b981;margin-bottom:15px">
<p style="margin:0;font-weight:bold;color:#059669">Invoice Successfully Sent</p>
<p style="margin:5px 0 0 0;font-size:13px">An invoice has been sent to Fernando Jimenez</p>
</div>

<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Client Information</h3>
<div style="border-top:1px solid #1e3a8a;margin-bottom:12px"></div>
<p><strong>Name:</strong> Fernando Jimenez<br>
<strong>Email:</strong> info@cleanersup.com<br>
<strong>Phone:</strong> (626) 555-0123<br>
<strong>Address:</strong> 818 w huntington dr, Arcadia, CA 91007</p>

<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Invoice Details</h3>
<div style="border-top:1px solid #1e3a8a;margin-bottom:12px"></div>
<p><strong>Invoice Number:</strong> INV-2025-003<br>
<strong>Invoice Date:</strong> 10/26/2025<br>
<strong>Due Date:</strong> 10/31/2025<br>
<strong>Service Type:</strong> Single</p>

<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Amount</h3>
<table cellpadding="0" cellspacing="0" style="width:100%;background-color:#f0fdf4">
  <tr>
    <td style="padding:16px">
      <table cellpadding="0" cellspacing="0" style="width:100%">
        <tr>
          <td style="padding:12px 0 0 0;text-align:left;font-weight:bold;font-size:20px;color:#1e3a8a">Total:</td>
          <td style="padding:12px 0 0 0;text-align:right;font-weight:bold;font-size:20px;color:#1e3a8a">$150.00</td>
        </tr>
      </table>
    </td>
  </tr>
</table>

<div style="background:#eff6ff;border-left:4px solid #3b82f6;padding:12px;margin:20px 0">
<p style="margin:0;font-size:13px;color:#1e40af">💡 The client can pay online using the payment link sent in their email.</p>
</div>

</div>

<div style="text-align:center;padding:15px;background:#1e3a8a;color:white">
<p style="margin:0 0 5px 0;font-size:12px">Service provided by</p>
<p style="margin:0">© 2024 Thunder Pro Inc. | <a href="https://www.thunderpro.co" style="color:white">www.thunderpro.co</a></p>
</div>

</div>
</body>
</html>`;

    console.log('Sending walkthrough reminder samples to:', email);

    // Walkthrough Reminder Emails (1 hour before) - Sample data
    const walkthroughReminderClient = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:20px;font-family:Arial,sans-serif">
<div style="max-width:600px;margin:0 auto">

<div style="text-align:center;padding:15px;background:#1e3a8a;color:white">
  <h1 style="margin:0;font-size:22px">Clean Up Company LLC Cleaning Services</h1>
  <p style="margin:5px 0">We're On Our Way!</p>
</div>

<div style="padding:15px">

<p style="font-size:16px;color:#1e3a8a">Dear John Smith,</p>

<div style="background:#dcfce7;border-left:4px solid #10b981;padding:12px;margin:20px 0">
<p style="margin:0;font-size:16px;font-weight:bold;color:#065f46">🚗 Our team will arrive in approximately 1 hour!</p>
</div>

<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Appointment Details</h3>
<div style="border-top:1px solid #1e3a8a;margin-bottom:12px"></div>
<p>
<strong>Today at:</strong> 10:00 AM<br>
<strong>Service Type:</strong> Residential Cleaning
</p>

<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Location</h3>
<div style="border-top:1px solid #1e3a8a;margin-bottom:12px"></div>
<p>
123 Main Street, Apt 4B<br>
Los Angeles, CA 90001
</p>

<h3 style="color:#1e3a8a;margin:20px 0 8px 0">What We'll Do</h3>
<div style="border-top:1px solid #1e3a8a;margin-bottom:12px"></div>
<ul style="color:#4b5563;line-height:1.8">
  <li>Assess your property's cleaning requirements</li>
  <li>Take measurements and photographs</li>
  <li>Answer all your questions</li>
  <li>Provide you with a detailed estimate</li>
</ul>

<div style="background:#eff6ff;border-left:4px solid #3b82f6;padding:12px;margin:20px 0">
<p style="margin:0;font-size:13px;color:#1e40af">📞 If you need to contact us before we arrive, please call (555) 999-8888.</p>
</div>

<p>We look forward to meeting you soon!</p>

</div>

<div style="text-align:center;padding:15px;background:#1e3a8a;color:white">
  <p style="margin:0 0 5px 0;font-size:12px">Service provided by</p>
  <p style="margin:0">© 2024 Thunder Pro Inc. | <a href="https://www.thunderpro.co" style="color:white">www.thunderpro.co</a></p>
</div>

</div>
</body>
</html>`;

    const walkthroughReminderOwner = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:20px;font-family:Arial,sans-serif">
<div style="max-width:600px;margin:0 auto">

<div style="text-align:center;padding:15px;background:#1e3a8a;color:white">
  <h1 style="margin:0;font-size:22px">Clean Up Company LLC Cleaning Services</h1>
  <p style="margin:5px 0">Walkthrough Reminder</p>
</div>

<div style="padding:15px">

<p style="font-size:16px;color:#1e3a8a">Hi,</p>

<div style="background:#fef3c7;border-left:4px solid #f59e0b;padding:12px;margin:20px 0">
<p style="margin:0;font-size:16px;font-weight:bold;color:#92400e">⏰ Walkthrough in 1 hour!</p>
</div>

<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Walkthrough Details</h3>
<div style="border-top:1px solid #1e3a8a;margin-bottom:12px"></div>
<p>
<strong>Today at:</strong> 10:00 AM<br>
<strong>Service Type:</strong> Residential<br>
<strong>Client:</strong> John Smith
</p>

<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Location</h3>
<div style="border-top:1px solid #1e3a8a;margin-bottom:12px"></div>
<p>
123 Main Street, Apt 4B<br>
Los Angeles, CA 90001 <a href="https://maps.google.com/?q=123+Main+Street,+Apt+4B,+Los+Angeles,+CA+90001" style="display:inline-block;background:#3b82f6;color:white;padding:4px 10px;text-decoration:none;border-radius:4px;font-size:12px;margin-left:8px">📍 Navigate</a><br>
<strong>Phone:</strong> (555) 123-4567
</p>

<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Assigned Team</h3>
<div style="border-top:1px solid #1e3a8a;margin-bottom:12px"></div>
<p>Maria Rodriguez, Carlos Martinez</p>

<div style="background:#eff6ff;border-left:4px solid #3b82f6;padding:12px;margin:20px 0">
<p style="margin:0;font-size:13px;color:#1e40af">💼 Don't forget to bring: measuring tools, camera, notepad, and business cards.</p>
</div>

</div>

<div style="text-align:center;padding:15px;background:#1e3a8a;color:white">
  <p style="margin:0 0 5px 0;font-size:12px">Service provided by</p>
  <p style="margin:0">© 2024 Thunder Pro Inc. | <a href="https://www.thunderpro.co" style="color:white">www.thunderpro.co</a></p>
</div>

</div>
</body>
</html>`;

    // Send reminder samples
    await sendEmailViaSMTP(
      email,
      'The walkthrough starts in 1 hour.',
      walkthroughReminderClient
    );

    console.log('Walkthrough reminder client sent');

    await sendEmailViaSMTP(
      email,
      'The walkthrough starts in 1 hour.',
      walkthroughReminderOwner
    );

    console.log('Walkthrough reminder owner sent');

    return new Response(
      JSON.stringify({ success: true, message: 'Reminder samples sent (client + owner)' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('Error sending sample emails:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
