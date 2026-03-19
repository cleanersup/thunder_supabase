import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.76.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

// Owner cancellation email template
const generateOwnerCancellationEmail = (walkthrough: any, contactInfo: any, companyInfo: any, timezone: string = 'UTC'): string => {
  const contactName = contactInfo.full_name || contactInfo.lead_name;
  
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:20px;font-family:Arial,sans-serif">
<div style="max-width:600px;margin:0 auto">

<div style="text-align:center;padding:15px;background:#dc2626;color:white">
  <h1 style="margin:0;font-size:22px">${companyInfo.company_name || 'Company Name'} Cleaning Services</h1>
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
<strong>Date:</strong> ${formatDate(walkthrough.scheduled_date, timezone)}<br>
<strong>Time:</strong> ${formatTime(walkthrough.scheduled_time)}<br>
<strong>Service Type:</strong> ${walkthrough.service_type === 'residential' ? 'Residential' : 'Commercial'}<br>
<strong>${walkthrough.walkthrough_type === 'client' ? 'Client' : 'Lead'}:</strong> ${contactName}
</p>

${contactInfo.service_street ? `
<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Location</h3>
<div style="border-top:1px solid #1e3a8a;margin-bottom:12px"></div>
<p>
${contactInfo.service_street}${contactInfo.service_apt ? `, ${contactInfo.service_apt}` : ''}<br>
${contactInfo.service_city}, ${contactInfo.service_state} ${contactInfo.service_zip}<br>
<strong>Phone:</strong> ${contactInfo.phone}
</p>
` : ''}

${contactInfo.street ? `
<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Location</h3>
<div style="border-top:1px solid #1e3a8a;margin-bottom:12px"></div>
<p>
${contactInfo.street}${contactInfo.apt_suite ? `, ${contactInfo.apt_suite}` : ''}<br>
${contactInfo.city}, ${contactInfo.state} ${contactInfo.zip_code}<br>
<strong>Phone:</strong> ${contactInfo.phone}
</p>
` : ''}

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
const generateContactCancellationEmail = (walkthrough: any, contactInfo: any, companyInfo: any, timezone: string = 'UTC'): string => {
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
  <h1 style="margin:0;font-size:22px">${companyInfo.company_name || 'Company Name'} Cleaning Services</h1>
  <p style="margin:5px 0">Appointment Update</p>
</div>

<div style="padding:15px">

<p style="font-size:16px;color:#1e3a8a">Dear ${contactName},</p>

<div style="background:#fee2e2;border-left:4px solid #dc2626;padding:12px;margin:20px 0">
<p style="margin:0;font-size:16px;font-weight:bold;color:#7f1d1d">Your walkthrough appointment has been cancelled</p>
</div>

<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Cancelled Appointment Details</h3>
<div style="border-top:1px solid #1e3a8a;margin-bottom:12px"></div>
<p>
<strong>Date:</strong> ${formatDate(walkthrough.scheduled_date, timezone)}<br>
<strong>Time:</strong> ${formatTime(walkthrough.scheduled_time)}<br>
<strong>Service Type:</strong> ${walkthrough.service_type === 'residential' ? 'Residential Cleaning' : 'Commercial Cleaning'}
</p>

${contactInfo.service_street ? `
<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Location</h3>
<div style="border-top:1px solid #1e3a8a;margin-bottom:12px"></div>
<p>
${contactInfo.service_street}${contactInfo.service_apt ? `, ${contactInfo.service_apt}` : ''}<br>
${contactInfo.service_city}, ${contactInfo.service_state} ${contactInfo.service_zip}
</p>
` : ''}

${contactInfo.street ? `
<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Location</h3>
<div style="border-top:1px solid #1e3a8a;margin-bottom:12px"></div>
<p>
${contactInfo.street}${contactInfo.apt_suite ? `, ${contactInfo.apt_suite}` : ''}<br>
${contactInfo.city}, ${contactInfo.state} ${contactInfo.zip_code}
</p>
` : ''}

<h3 style="color:#1e3a8a;margin:20px 0 8px 0">What's Next?</h3>
<div style="border-top:1px solid #1e3a8a;margin-bottom:12px"></div>
<p style="color:#4b5563;line-height:1.8">
We apologize for any inconvenience this may cause. If you would like to reschedule your walkthrough, please don't hesitate to contact us. We're here to help!
</p>

<div style="background:#eff6ff;border-left:4px solid #3b82f6;padding:12px;margin:20px 0">
<p style="margin:0;font-size:13px;color:#1e40af">📞 To reschedule or if you have any questions, please call us at ${companyInfo.company_phone || 'Company Phone Number'}.</p>
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
  console.log('=== STARTING SMTP EMAIL PROCESS ===');
  console.log('📧 To:', toEmail);
  console.log('📧 Subject:', subject);
  
  const smtpHost = "email-smtp.us-east-2.amazonaws.com";
  const smtpPort = 587;
  const smtpUser = Deno.env.get('AWS_SES_SMTP_USERNAME') || '';
  const smtpPass = Deno.env.get('AWS_SES_SMTP_PASSWORD') || '';
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

  let conn: Deno.TcpConn | null = null;
  let tlsConn: Deno.TlsConn | null = null;

  try {
    console.log('[1/10] Connecting to SMTP server...');
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
      step?: string,
      maskInLog: boolean = false
    ): Promise<string> => {
      const displayCommand = maskInLog ? command.substring(0, 15) + '...' : command;
      if (step) {
        console.log(`${step} Sending: ${displayCommand}`);
      }
      await connection.write(encoder.encode(command + '\r\n'));
      const response = await readResponse(connection);
      if (step) {
        console.log(`${step} Response: ${response.trim()}`);
      }
      const responseCode = response.substring(0, 3);
      if (responseCode.startsWith('4') || responseCode.startsWith('5')) {
        throw new Error(`SMTP Error ${responseCode}: ${response.trim()}`);
      }
      return response;
    };

    const greeting = await readResponse(conn);
    console.log('[1/10] ✓ Server greeting:', greeting.trim());

    console.log('[2/10] Sending EHLO...');
    await sendCommand(conn, 'EHLO thunderpro.co', '[2/10]');
    console.log('[2/10] ✓ EHLO sent');
    
    console.log('[3/10] Sending STARTTLS...');
    await sendCommand(conn, 'STARTTLS', '[3/10]');
    console.log('[3/10] ✓ STARTTLS sent');

    console.log('[4/10] Upgrading to TLS...');
    tlsConn = await Deno.startTls(conn, { hostname: smtpHost });
    console.log('[4/10] ✓ TLS connection established');

    console.log('[5/10] Sending EHLO after TLS...');
    await sendCommand(tlsConn, 'EHLO thunderpro.co', '[5/10]');
    console.log('[5/10] ✓ EHLO after TLS sent');
    
    console.log('[6/10] Starting AUTH LOGIN...');
    await tlsConn.write(encoder.encode('AUTH LOGIN\r\n'));
    const authResponse = await readResponse(tlsConn);
    console.log('[6/10] AUTH LOGIN response:', authResponse.trim());
    console.log('[6/10] ✓ AUTH LOGIN sent');
    
    console.log('[7/10] Sending username...');
    const authUserResponse = await sendCommand(tlsConn, btoa(smtpUser), '[7/10]', true);
    if (authUserResponse.includes('535')) {
      console.error('❌ Authentication failed - invalid username');
      throw new Error('Credenciales SMTP inválidas. Verifica AWS_SES_SMTP_USERNAME y AWS_SES_SMTP_PASSWORD');
    }
    console.log('[7/10] ✓ Username accepted');
    
    console.log('[7/10] Sending password...');
    const authPassResponse = await sendCommand(tlsConn, btoa(smtpPass), '[7/10]', true);
    if (authPassResponse.includes('535')) {
      console.error('❌ Authentication failed - invalid password');
      throw new Error('Credenciales SMTP inválidas. Verifica AWS_SES_SMTP_USERNAME y AWS_SES_SMTP_PASSWORD');
    }
    console.log('[7/10] ✓ Authentication successful');
    
    console.log('[8/10] Sending MAIL FROM...');
    await sendCommand(tlsConn, `MAIL FROM:<${fromEmailAddress}>`, '[8/10]');
    console.log('[8/10] ✓ MAIL FROM sent');
    
    console.log('[8/10] Sending RCPT TO...');
    await sendCommand(tlsConn, `RCPT TO:<${toEmail}>`, '[8/10]');
    console.log('[8/10] ✓ RCPT TO sent');
    
    console.log('[9/10] Sending DATA command...');
    await sendCommand(tlsConn, 'DATA', '[9/10]');
    console.log('[9/10] ✓ DATA command sent');

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
    
    const emailContent = headers + '\r\n' + htmlContent;
    
    console.log('[9/10] Sending email content...');
    console.log('[9/10] Email content length:', emailContent.length, 'bytes');
    await tlsConn.write(encoder.encode(headers + '\r\n'));

    const chunkSize = 4096;
    const contentBytes = encoder.encode(htmlContent);
    for (let i = 0; i < contentBytes.length; i += chunkSize) {
      const chunk = contentBytes.slice(i, Math.min(i + chunkSize, contentBytes.length));
      await tlsConn.write(chunk);
    }
    
    await tlsConn.write(encoder.encode('\r\n.\r\n'));
    const dataResponse = await readResponse(tlsConn);
    console.log('[9/10] ✓ Email content sent');
    console.log('[9/10] DATA response:', dataResponse.trim());
    
    // Check if DATA command was successful (250 response code)
    const dataResponseCode = dataResponse.substring(0, 3);
    if (!dataResponseCode.startsWith('2')) {
      console.error('❌ DATA command failed:', dataResponse.trim());
      throw new Error(`SMTP DATA command failed: ${dataResponse.trim()}`);
    }
    
    console.log('[10/10] Sending QUIT...');
    await sendCommand(tlsConn, 'QUIT', '[10/10]');
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
    
    try {
      if (tlsConn) tlsConn.close();
      if (conn) conn.close();
    } catch (closeError) {
      console.error('Error closing connections:', closeError);
    }
    throw error;
  }
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { walkthroughId } = await req.json();

    if (!walkthroughId) {
      throw new Error('Walkthrough ID is required');
    }

    console.log('📧 Sending cancellation emails for walkthrough:', walkthroughId);

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Get walkthrough details
    const { data: walkthrough, error: wtError } = await supabaseClient
      .from('walkthroughs')
      .select('*')
      .eq('id', walkthroughId)
      .single();

    if (wtError || !walkthrough) {
      throw new Error('Walkthrough not found');
    }

    // Get company info and timezone
    const { data: companyInfo } = await supabaseClient
      .from('profiles')
      .select('company_name, company_email, company_phone, timezone')
      .eq('user_id', walkthrough.user_id)
      .maybeSingle();

    const userTimezone = companyInfo?.timezone || 'UTC';
    console.log('✅ User timezone:', userTimezone);

    // Get contact information (client or lead)
    let contactInfo: any = null;
    
    if (walkthrough.walkthrough_type === 'client' && walkthrough.client_id) {
      const { data: client } = await supabaseClient
        .from('clients')
        .select('*')
        .eq('id', walkthrough.client_id)
        .single();
      contactInfo = client;
    } else if (walkthrough.walkthrough_type === 'lead' && walkthrough.lead_id) {
      // Try leads table first
      const { data: lead } = await supabaseClient
        .from('leads')
        .select('*')
        .eq('id', walkthrough.lead_id)
        .maybeSingle();
      
      if (lead) {
        contactInfo = lead;
      } else {
        // Try bookings table
        const { data: booking } = await supabaseClient
          .from('bookings')
          .select('*')
          .eq('id', walkthrough.lead_id)
          .maybeSingle();
        contactInfo = booking;
      }
    }

    if (!contactInfo) {
      throw new Error('Contact information not found');
    }

    console.log('=== WALKTHROUGH CANCELLATION EMAIL PROCESS ===');
    console.log('User timezone:', userTimezone);
    console.log('Walkthrough ID:', walkthroughId);
    console.log('Walkthrough type:', walkthrough.walkthrough_type);
    console.log('Contact info:', {
      name: contactInfo.full_name || contactInfo.lead_name,
      email: contactInfo.email,
      phone: contactInfo.phone
    });

    let ownerEmailSent = false;
    let clientEmailSent = false;

    // Send email to owner
    const ownerEmail = companyInfo?.company_email;
    console.log('=== OWNER EMAIL ===');
    console.log('Owner email address:', ownerEmail);
    
    if (!ownerEmail) {
      console.warn('⚠️ No owner email address found - skipping owner email');
    } else {
      try {
        console.log('Sending owner cancellation email...');
        await sendEmailViaSMTP(
          ownerEmail,
          'Walkthrough Successfully Cancelled',
          generateOwnerCancellationEmail(walkthrough, contactInfo, companyInfo, userTimezone)
        );
        ownerEmailSent = true;
        console.log('✅ Owner cancellation email sent successfully to:', ownerEmail);
      } catch (error: any) {
        console.error('❌ Failed to send owner cancellation email:', error.message);
        // Don't throw - continue with client email
      }
    }

    // Send email to client/lead
    const clientEmail = contactInfo.email;
    console.log('=== CLIENT EMAIL ===');
    console.log('Client email address:', clientEmail);
    
    if (!clientEmail) {
      console.warn('⚠️ No client email address found - skipping client email');
    } else {
      try {
        console.log('Sending client cancellation email...');
        await sendEmailViaSMTP(
          clientEmail,
          'Walkthrough Successfully Cancelled',
          generateContactCancellationEmail(walkthrough, contactInfo, companyInfo || {}, userTimezone)
        );
        clientEmailSent = true;
        console.log('✅ Client cancellation email sent successfully to:', clientEmail);
      } catch (error: any) {
        console.error('❌ Failed to send client cancellation email:', error.message);
        // Don't throw - owner email might have been sent successfully
      }
    }

    const responseMessage = clientEmailSent && ownerEmailSent
      ? 'Cancellation emails sent successfully'
      : ownerEmailSent
        ? 'Owner email sent, but client email was not sent (no email address)'
        : clientEmailSent
          ? 'Client email sent, but owner email was not sent (no email address)'
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
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      }
    );

  } catch (error: any) {
    console.error('❌ Error sending cancellation emails:', error);
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
