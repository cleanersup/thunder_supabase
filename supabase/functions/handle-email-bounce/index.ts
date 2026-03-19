import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// SMTP email sending function (same as other email functions)
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
  const fromEmail = '"Thunder Pro Alerts" <info@thunderpro.co>';

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
      `X-Mailer: ThunderPro-Alerts`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=UTF-8',
      '',
    ].join('\r\n');
    
    await tlsConn.write(encoder.encode(headers + '\r\n'));

    console.log('[9/10] Sending email body in chunks...');
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

// Generate bounce notification email template
function generateBounceNotificationEmail(
  companyName: string,
  bounceDetails: {
    recipientEmail: string;
    bounceType: string;
    bounceSubType: string;
    diagnosticCode: string;
    documentType: string;
    documentNumber: string;
    timestamp: string;
  }
): string {
  // Determine bounce reason in English
  let bounceReason = '';
  let recommendation = '';
  
  if (bounceDetails.bounceSubType.includes('NoEmail') || bounceDetails.bounceSubType.includes('DoesNotExist')) {
    bounceReason = 'Email address does not exist';
    recommendation = 'Verify that the email address is written correctly.';
  } else if (bounceDetails.bounceSubType.includes('Suppressed')) {
    bounceReason = 'Recipient has blocked emails';
    recommendation = 'Contact the client through another channel (phone, WhatsApp).';
  } else if (bounceDetails.bounceSubType.includes('MailboxFull')) {
    bounceReason = 'Mailbox is full';
    recommendation = 'Try resending the email later or contact by phone.';
  } else if (bounceDetails.bounceSubType.includes('MessageTooLarge')) {
    bounceReason = 'Message is too large';
    recommendation = 'Try sending the document without large attachments.';
  } else if (bounceDetails.bounceType === 'Transient') {
    bounceReason = 'Temporary email server error';
    recommendation = 'The email will be resent automatically. If it persists, contact the client.';
  } else {
    bounceReason = 'Unknown error';
    recommendation = 'Verify the email address and contact the client through another channel.';
  }

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background-color:#f5f5f5">
<table cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f5f5f5;padding:20px 0">
  <tr>
    <td align="center">
      <table cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;background-color:#ffffff">
        
        <!-- Header -->
        <tr>
          <td align="center" style="background-color:#dc2626;padding:15px;color:#ffffff">
            <p style="margin:0 0 5px 0;padding:0;font-size:14px;color:#ffffff">${companyName}</p>
            <h1 style="margin:0;padding:0;font-size:22px;color:#ffffff">⚠️ Email Delivery Failed</h1>
          </td>
        </tr>
        
        <!-- Content -->
        <tr>
          <td style="padding:20px">
            
            <!-- Alert Message -->
            <table cellpadding="12" cellspacing="0" border="0" width="100%" style="background-color:#fef2f2;border-left:4px solid #dc2626;margin-bottom:15px">
              <tr>
                <td>
                  <p style="margin:0 0 5px 0;padding:0;font-weight:bold;color:#dc2626">❌ Email could not be delivered</p>
                  <p style="margin:0;padding:0;font-size:13px;color:#991b1b">An email you attempted to send bounced and did not reach the recipient.</p>
                </td>
              </tr>
            </table>
            
            <!-- Bounce Details -->
            <table cellpadding="0" cellspacing="0" border="0" width="100%">
              <tr>
                <td>
                  <h3 style="margin:0 0 8px 0;padding:0;color:#1e3a8a;font-size:16px">Bounced Email Details</h3>
                  <div style="border-top:2px solid #1e3a8a;margin-bottom:12px"></div>
                  <p style="margin:0;padding:0;line-height:1.6;color:#333333">
                    <strong>📧 Recipient:</strong> ${bounceDetails.recipientEmail}<br>
                    <strong>📄 Invoice:</strong> #${bounceDetails.documentNumber}<br>
                    <strong>🕐 Date/Time:</strong> ${new Date(bounceDetails.timestamp).toLocaleString('en-US', { 
                      timeZone: 'America/New_York',
                      dateStyle: 'medium',
                      timeStyle: 'short'
                    })}<br>
                    <strong>⚠️ Reason:</strong> ${bounceReason}
                  </p>
                </td>
              </tr>
            </table>
            
            <!-- Recommendations -->
            <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:20px">
              <tr>
                <td>
                  <h3 style="margin:0 0 8px 0;padding:0;color:#1e3a8a;font-size:16px">What to do now?</h3>
                  <div style="border-top:2px solid #1e3a8a;margin-bottom:12px"></div>
                </td>
              </tr>
            </table>
            
            <!-- Recommendation Box -->
            <table cellpadding="12" cellspacing="0" border="0" width="100%" style="background-color:#eff6ff;border-left:4px solid #3b82f6;margin-bottom:20px">
              <tr>
                <td>
                  <p style="margin:0;padding:0;font-size:14px;color:#1e40af">💡 <strong>Recommendation:</strong><br>${recommendation}</p>
                </td>
              </tr>
            </table>
            
            <!-- Important Notice -->
            <table cellpadding="12" cellspacing="0" border="0" width="100%" style="margin-top:20px;background-color:#fef3c7;border-left:4px solid #f59e0b">
              <tr>
                <td>
                  <p style="margin:0;padding:0;font-size:13px;color:#92400e">⚠️ <strong>Important:</strong> This is an automated email generated by the system when it detects that an email could not be delivered. Review the client's information and update their contact details if necessary.</p>
                </td>
              </tr>
            </table>
            
          </td>
        </tr>
        
        <!-- Footer -->
        <tr>
          <td align="center" style="background-color:#1e3a8a;padding:15px;color:#ffffff">
            <p style="margin:0 0 5px 0;padding:0;font-size:12px;color:#ffffff">Service provided by</p>
            <p style="margin:0;padding:0;font-size:12px;color:#ffffff">© 2024 Thunder Pro Inc. | <a href="https://www.thunderpro.co" style="color:#ffffff;text-decoration:underline">www.thunderpro.co</a></p>
          </td>
        </tr>
        
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

// Main handler
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('=== Bounce Notification Handler ===');
    
    const contentType = req.headers.get('content-type') || '';
    const body = await req.text();
    
    console.log('Raw body:', body);
    console.log('Content-Type:', contentType);

    // Parse the SNS message
    let message;
    let testEmail: string | null = null;
    try {
      const payload = JSON.parse(body);
      
      // Check for test email override
      if (payload.test_email) {
        testEmail = payload.test_email;
        console.log('Test email override detected:', testEmail);
      }
      
      // Handle SNS subscription confirmation
      if (payload.Type === 'SubscriptionConfirmation') {
        console.log('SNS Subscription Confirmation received');
        console.log('Subscribe URL:', payload.SubscribeURL);
        
        // Automatically confirm subscription
        if (payload.SubscribeURL) {
          const confirmResponse = await fetch(payload.SubscribeURL);
          console.log('Subscription confirmed:', confirmResponse.ok);
        }
        
        return new Response(
          JSON.stringify({ message: 'Subscription confirmed' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      // Handle SNS notification
      if (payload.Type === 'Notification') {
        message = JSON.parse(payload.Message);
      } else {
        message = payload;
      }
    } catch (error) {
      console.error('Error parsing message:', error);
      throw new Error('Invalid message format');
    }

    console.log('Parsed message:', JSON.stringify(message, null, 2));

    // Extract bounce details
    if (message.notificationType !== 'Bounce') {
      console.log('Not a bounce notification, ignoring');
      return new Response(
        JSON.stringify({ message: 'Not a bounce notification' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const bounce = message.bounce;
    const mail = message.mail;
    const bouncedRecipients = bounce.bouncedRecipients || [];

    if (bouncedRecipients.length === 0) {
      console.log('No bounced recipients');
      return new Response(
        JSON.stringify({ message: 'No bounced recipients' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get the first bounced recipient
    const recipient = bouncedRecipients[0];
    const recipientEmail = recipient.emailAddress;
    const bounceType = bounce.bounceType || 'Unknown';
    const bounceSubType = bounce.bounceSubType || 'Unknown';
    const diagnosticCode = recipient.diagnosticCode || '';

    console.log('Bounce details:', {
      recipientEmail,
      bounceType,
      bounceSubType,
      diagnosticCode
    });

    // Extract document information from email subject or custom headers
    const subject = mail.commonHeaders?.subject || '';
    let documentType = 'Documento';
    let documentNumber = 'N/A';

    if (subject.includes('invoice') || subject.includes('Invoice')) {
      documentType = 'Factura';
      const match = subject.match(/#?(\d+)/);
      if (match) documentNumber = match[1];
    } else if (subject.includes('estimate') || subject.includes('Estimate')) {
      documentType = 'Estimado';
      const match = subject.match(/#?(\d+)/);
      if (match) documentNumber = match[1];
    } else if (subject.includes('appointment') || subject.includes('Appointment')) {
      documentType = 'Cita';
    } else if (subject.includes('timesheet') || subject.includes('Timesheet')) {
      documentType = 'Hoja de Horas';
    } else if (subject.includes('booking') || subject.includes('Booking')) {
      documentType = 'Reserva';
    }

    // Find the user who sent the email
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Try to find user by matching the recipient email in various tables
    let ownerEmail: string | null = null;
    let companyName = 'Thunder Pro';

    // If test email is provided, skip database lookup
    if (!testEmail) {
      // Check invoices table
      const { data: invoice } = await supabase
        .from('invoices')
        .select('user_id, invoice_number')
        .eq('email', recipientEmail)
        .limit(1)
        .maybeSingle();

      if (invoice) {
        documentType = 'Factura';
        documentNumber = invoice.invoice_number;
        
        const { data: profile } = await supabase
          .from('profiles')
          .select('company_email, company_name')
          .eq('user_id', invoice.user_id)
          .single();
        
        if (profile) {
          ownerEmail = profile.company_email;
          companyName = profile.company_name || companyName;
        }
      }

      // Check estimates table if not found in invoices
      if (!ownerEmail) {
        const { data: estimate } = await supabase
          .from('estimates')
          .select('user_id, id')
          .eq('email', recipientEmail)
          .limit(1)
          .maybeSingle();

        if (estimate) {
          documentType = 'Estimado';
          documentNumber = estimate.id.substring(0, 8);
          
          const { data: profile } = await supabase
            .from('profiles')
            .select('company_email, company_name')
            .eq('user_id', estimate.user_id)
            .single();
          
          if (profile) {
            ownerEmail = profile.company_email;
            companyName = profile.company_name || companyName;
          }
        }
      }

      // Check bookings table if not found
      if (!ownerEmail) {
        const { data: booking } = await supabase
          .from('bookings')
          .select('business_owner_id, id')
          .eq('email', recipientEmail)
          .limit(1)
          .maybeSingle();

        if (booking) {
          documentType = 'Reserva';
          documentNumber = booking.id.substring(0, 8);
          
          const { data: profile } = await supabase
            .from('profiles')
            .select('company_email, company_name')
            .eq('user_id', booking.business_owner_id)
            .single();
          
          if (profile) {
            ownerEmail = profile.company_email;
            companyName = profile.company_name || companyName;
          }
        }
      }
    }

    // Use test email if provided, otherwise use owner email
    const recipientForNotification = testEmail || ownerEmail;

    if (!recipientForNotification) {
      console.log('Could not find owner email for bounced recipient');
      return new Response(
        JSON.stringify({ message: 'Owner email not found' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Sending bounce notification to:', recipientForNotification);

    // Generate and send bounce notification email
    const bounceDetails = {
      recipientEmail,
      bounceType,
      bounceSubType,
      diagnosticCode,
      documentType,
      documentNumber,
      timestamp: message.bounce.timestamp
    };

    const emailHtml = generateBounceNotificationEmail(companyName, bounceDetails);

    await sendEmailViaSMTP(
      recipientForNotification,
      `Email Delivery Failed: ${documentType} #${documentNumber}`,
      emailHtml
    );

    console.log('Bounce notification sent successfully');

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Bounce notification sent',
        details: bounceDetails
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Error in handle-email-bounce:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
