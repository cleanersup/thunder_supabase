import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface WalkthroughCompletionRequest {
  walkthroughId: string;
}

// Date-only (YYYY-MM-DD) parsed as UTC midnight causes day shift. Use midday UTC to avoid.
const formatDate = (dateStr: string, timezone: string = 'UTC'): string => {
  try {
    if (!dateStr) return 'N/A';
    const [year, month, day] = dateStr.split('-').map(Number);
    const dateAtMidday = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
    return new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    }).format(dateAtMidday);
  } catch (error) {
    console.error('Error formatting date:', error);
    return dateStr;
  }
};

// scheduled_time is already in the user's local timezone (what they selected when scheduling)
// Format directly without timezone conversion to avoid offset (e.g. 5-hour) errors
const formatTime = (timeStr: string): string => {
  if (!timeStr) return 'Not specified';
  try {
    const parts = timeStr.split(':');
    const hour = parseInt(parts[0], 10);
    const minutes = parts[1] ? parseInt(parts[1], 10) : 0;
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${minutes.toString().padStart(2, '0')} ${ampm}`;
  } catch (error) {
    console.error('Error formatting time:', error);
    return timeStr;
  }
};

const generateOwnerEmailTemplate = (walkthrough: any, contactInfo: any, companyInfo: any, timezone: string = 'UTC'): string => {
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

const generateClientEmailTemplate = (walkthrough: any, contactInfo: any, companyInfo: any, timezone: string = 'UTC'): string => {
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

const sendEmailViaSMTP = async (
  toEmail: string,
  subject: string,
  htmlContent: string
): Promise<void> => {
  console.log('=== STARTING SMTP EMAIL PROCESS ===');
  console.log('📧 To:', toEmail);
  console.log('📧 Subject:', subject);
  
  const smtpHost = 'email-smtp.us-east-2.amazonaws.com';
  const smtpPort = 587;
  const smtpUser = Deno.env.get('AWS_SES_SMTP_USERNAME');
  const smtpPass = Deno.env.get('AWS_SES_SMTP_PASSWORD');
  const fromEmail = Deno.env.get('AWS_SES_FROM_EMAIL') || '"Thunder Pro" <info@thunderpro.co>';

  // Extract just the email address for MAIL FROM command (SMTP doesn't accept display names)
  // Handle formats like: "Name" <email@domain.com> or just email@domain.com
  let fromEmailAddress = fromEmail;
  const emailMatch = fromEmail.match(/<([^>]+)>/);
  if (emailMatch) {
    fromEmailAddress = emailMatch[1]; // Extract email from <email@domain.com>
  } else {
    // If no angle brackets, use the whole string (assuming it's just an email)
    fromEmailAddress = fromEmail.trim();
  }

  console.log('📧 SMTP Configuration:', {
    smtpHost,
    smtpPort,
    fromEmail,
    fromEmailAddress, // The actual email address for MAIL FROM
    hasSmtpUser: !!smtpUser,
    hasSmtpPass: !!smtpPass
  });

  if (!smtpUser || !smtpPass) {
    console.error('❌ SMTP credentials not configured');
    throw new Error('SMTP credentials not configured');
  }

  const conn = await Deno.connect({ hostname: smtpHost, port: smtpPort });
  const textEncoder = new TextEncoder();
  const textDecoder = new TextDecoder();

  const readResponse = async (): Promise<string> => {
    const buffer = new Uint8Array(4096);
    const n = await conn.read(buffer);
    return textDecoder.decode(buffer.subarray(0, n || 0));
  };

  const sendCommand = async (command: string): Promise<string> => {
    await conn.write(textEncoder.encode(command + '\r\n'));
    return await readResponse();
  };

  let tlsConn: Deno.TlsConn | null = null;
  
  try {
    console.log('[1/10] Connecting to SMTP server...');
    const greeting = await readResponse();
    console.log('[1/10] ✓ Server greeting:', greeting.trim());
    
    console.log('[2/10] Sending EHLO...');
    await sendCommand('EHLO localhost');
    console.log('[2/10] ✓ EHLO sent');
    
    console.log('[3/10] Sending STARTTLS...');
    await sendCommand('STARTTLS');
    console.log('[3/10] ✓ STARTTLS sent');

    console.log('[4/10] Upgrading to TLS...');
    tlsConn = await Deno.startTls(conn, { hostname: smtpHost });
    console.log('[4/10] ✓ TLS connection established');
    
    const tlsEncoder = new TextEncoder();
    const tlsDecoder = new TextDecoder();

    const tlsReadResponse = async (): Promise<string> => {
      const buffer = new Uint8Array(4096);
      const n = await tlsConn!.read(buffer);
      return tlsDecoder.decode(buffer.subarray(0, n || 0));
    };

    const tlsSendCommand = async (command: string, step: string, maskInLog: boolean = false): Promise<string> => {
      const displayCommand = maskInLog ? command.substring(0, 15) + '...' : command;
      console.log(`${step} Sending: ${displayCommand}`);
      await tlsConn!.write(tlsEncoder.encode(command + '\r\n'));
      const response = await tlsReadResponse();
      console.log(`${step} Response: ${response.trim()}`);
      
      const responseCode = response.substring(0, 3);
      if (responseCode.startsWith('4') || responseCode.startsWith('5')) {
        throw new Error(`SMTP Error ${responseCode}: ${response.trim()}`);
      }
      
      return response;
    };

    console.log('[5/10] Sending EHLO after TLS...');
    await tlsSendCommand('EHLO localhost', '[5/10]');
    console.log('[5/10] ✓ EHLO after TLS sent');
    
    console.log('[6/10] Starting AUTH LOGIN...');
    await tlsSendCommand('AUTH LOGIN', '[6/10]');
    console.log('[6/10] ✓ AUTH LOGIN sent');
    
    console.log('[7/10] Sending username...');
    const authUserResponse = await tlsSendCommand(btoa(smtpUser), '[7/10]', true);
    if (authUserResponse.includes('535')) {
      console.error('❌ Authentication failed - invalid username');
      throw new Error('Credenciales SMTP inválidas. Verifica AWS_SES_SMTP_USERNAME y AWS_SES_SMTP_PASSWORD');
    }
    console.log('[7/10] ✓ Username accepted');
    
    console.log('[7/10] Sending password...');
    const authPassResponse = await tlsSendCommand(btoa(smtpPass), '[7/10]', true);
    if (authPassResponse.includes('535')) {
      console.error('❌ Authentication failed - invalid password');
      throw new Error('Credenciales SMTP inválidas. Verifica AWS_SES_SMTP_USERNAME y AWS_SES_SMTP_PASSWORD');
    }
    console.log('[7/10] ✓ Authentication successful');
    
    console.log('[8/10] Sending MAIL FROM...');
    await tlsSendCommand(`MAIL FROM:<${fromEmailAddress}>`, '[8/10]');
    console.log('[8/10] ✓ MAIL FROM sent');
    
    console.log('[8/10] Sending RCPT TO...');
    await tlsSendCommand(`RCPT TO:<${toEmail}>`, '[8/10]');
    console.log('[8/10] ✓ RCPT TO sent');
    
    console.log('[9/10] Sending DATA command...');
    await tlsSendCommand('DATA', '[9/10]');
    console.log('[9/10] ✓ DATA command sent');

    const timestamp = Date.now();
    const randomId = Math.random().toString(36).substring(2, 15);
    const messageId = `<${timestamp}.${randomId}@thunderpro.co>`;

    const emailContent = [
      `From: ${fromEmail}`,
      `To: ${toEmail}`,
      `Subject: ${subject}`,
      `Message-ID: ${messageId}`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=UTF-8',
      '',
      htmlContent,
      '.',
    ].join('\r\n');

    console.log('[9/10] Sending email content...');
    console.log('[9/10] Email content length:', emailContent.length, 'bytes');
    await tlsConn.write(tlsEncoder.encode(emailContent + '\r\n'));
    
    const dataResponse = await tlsReadResponse();
    console.log('[9/10] ✓ Email content sent');
    console.log('[9/10] DATA response:', dataResponse.trim());
    
    // Check if DATA command was successful (250 response code)
    const dataResponseCode = dataResponse.substring(0, 3);
    if (!dataResponseCode.startsWith('2')) {
      console.error('❌ DATA command failed:', dataResponse.trim());
      throw new Error(`SMTP DATA command failed: ${dataResponse.trim()}`);
    }
    
    console.log('[10/10] Sending QUIT...');
    await tlsSendCommand('QUIT', '[10/10]');
    console.log('[10/10] ✓ QUIT sent');
    
    // Close connections safely
    try {
      tlsConn.close();
    } catch (closeError) {
      console.error('Error closing TLS connection:', closeError);
    }
    
    console.log('=== EMAIL SENT SUCCESSFULLY ===');
    console.log('✅ Email sent to:', toEmail);
  } catch (error: any) {
    console.error('=== SMTP ERROR ===');
    console.error('Error sending email to:', toEmail);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    
    // Close connections safely in case of error
    if (tlsConn) {
      try {
        tlsConn.close();
      } catch (closeError) {
        console.error('Error closing TLS connection:', closeError);
      }
    }
    try {
      conn.close();
    } catch (closeError) {
      console.error('Error closing connection:', closeError);
    }
    throw error;
  }
};

const handler = async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('No authorization header');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      throw new Error('Unauthorized');
    }

    const { walkthroughId }: WalkthroughCompletionRequest = await req.json();

    if (!walkthroughId) {
      throw new Error('Walkthrough ID is required');
    }

    console.log('Fetching walkthrough data for ID:', walkthroughId);

    const { data: walkthrough, error: walkthroughError } = await supabase
      .from('walkthroughs')
      .select('*')
      .eq('id', walkthroughId)
      .eq('user_id', user.id)
      .single();

    if (walkthroughError || !walkthrough) {
      throw new Error('Walkthrough not found');
    }

    let contactInfo: any = null;
    if (walkthrough.walkthrough_type === 'client' && walkthrough.client_id) {
      const { data: client } = await supabase
        .from('clients')
        .select('full_name, company, phone, email, service_street, service_city, service_state, service_zip')
        .eq('id', walkthrough.client_id)
        .single();
      contactInfo = client;
    } else if (walkthrough.walkthrough_type === 'lead' && walkthrough.lead_id) {
      const { data: lead } = await supabase
        .from('leads')
        .select('full_name, company_name, phone, email, address, city, state, zip_code')
        .eq('id', walkthrough.lead_id)
        .maybeSingle();

      if (lead) {
        contactInfo = {
          full_name: lead.full_name,
          company: lead.company_name,
          phone: lead.phone,
          email: lead.email,
          service_street: lead.address,
          service_city: lead.city,
          service_state: lead.state,
          service_zip: lead.zip_code,
        };
      } else {
        const { data: booking } = await supabase
          .from('bookings')
          .select('lead_name, phone, email, street, city, state, zip_code')
          .eq('id', walkthrough.lead_id)
          .maybeSingle();

        if (booking) {
          contactInfo = {
            full_name: booking.lead_name,
            company: null,
            phone: booking.phone,
            email: booking.email,
            service_street: booking.street,
            service_city: booking.city,
            service_state: booking.state,
            service_zip: booking.zip_code,
          };
        }
      }
    }

    if (!contactInfo) {
      throw new Error('Contact information not found');
    }

    const { data: companyInfo } = await supabase
      .from('profiles')
      .select('company_name, company_phone, company_email, timezone')
      .eq('user_id', user.id)
      .single();

    const userTimezone = companyInfo?.timezone || 'UTC';
    console.log('=== WALKTHROUGH COMPLETION EMAIL PROCESS ===');
    console.log('User timezone:', userTimezone);
    console.log('Walkthrough ID:', walkthroughId);
    console.log('Walkthrough type:', walkthrough.walkthrough_type);
    console.log('Contact info:', {
      name: contactInfo.full_name,
      email: contactInfo.email,
      phone: contactInfo.phone
    });

    let ownerEmailSent = false;
    let clientEmailSent = false;

    // Owner email
    const ownerEmail = companyInfo?.company_email || user.email || '';
    console.log('=== OWNER EMAIL ===');
    console.log('Owner email address:', ownerEmail);
    console.log('Owner email from company_email:', companyInfo?.company_email);
    console.log('Owner email from user.email:', user.email);
    
    if (!ownerEmail) {
      console.error('❌ No owner email address found');
      throw new Error('No owner email address found');
    }

    try {
      const ownerEmailHtml = generateOwnerEmailTemplate(walkthrough, contactInfo, companyInfo || {}, userTimezone);
      console.log('Sending owner email...');
      await sendEmailViaSMTP(
        ownerEmail,
        'Congratulations! Walkthrough Completed',
        ownerEmailHtml
      );
      ownerEmailSent = true;
      console.log('✅ Owner email sent successfully to:', ownerEmail);
    } catch (error: any) {
      console.error('❌ Failed to send owner email:', error.message);
      throw error;
    }

    // Client email
    const clientEmail = contactInfo.email;
    console.log('=== CLIENT EMAIL ===');
    console.log('Client email address:', clientEmail);
    
    if (!clientEmail) {
      console.warn('⚠️ No client email address found - skipping client email');
    } else {
      try {
        const clientEmailHtml = generateClientEmailTemplate(walkthrough, contactInfo, companyInfo || {}, userTimezone);
        console.log('Sending client email...');
        await sendEmailViaSMTP(
          clientEmail,
          'Your Estimate is Being Prepared',
          clientEmailHtml
        );
        clientEmailSent = true;
        console.log('✅ Client email sent successfully to:', clientEmail);
      } catch (error: any) {
        console.error('❌ Failed to send client email:', error.message);
        // Don't throw - owner email was sent successfully
      }
    }

    const responseMessage = clientEmailSent 
      ? 'Completion emails sent successfully'
      : ownerEmailSent 
        ? 'Owner email sent, but client email was not sent (no email address)'
        : 'Some emails failed to send';

    console.log('=== EMAIL SENDING COMPLETED ===');
    console.log('Owner email sent:', ownerEmailSent);
    console.log('Client email sent:', clientEmailSent);

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: responseMessage,
        ownerEmailSent,
        clientEmailSent,
        contactHasEmail: !!contactInfo.email
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );

  } catch (error: any) {
    console.error('Error in send-walkthrough-completion:', error);
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
