import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.76.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Helper to format date - use stored date directly without timezone conversion
// scheduled_date is stored as 'YYYY-MM-DD' (e.g., '2025-12-15')
const formatDate = (dateStr: string) => {
  try {
    const [year, month, day] = dateStr.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    return new Intl.DateTimeFormat('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    }).format(date);
  } catch (error) {
    console.error('Error formatting date:', error);
    return dateStr;
  }
};

// Helper to format time - use stored time directly without timezone conversion
// scheduled_time is stored as 'HH:MM' (e.g., '20:43' = 8:43 PM)
const formatTime = (timeStr: string) => {
  if (!timeStr) return 'Not specified';
  try {
    const [hours, minutes] = timeStr.split(':').map(Number);
    const hour = hours % 12 || 12;
    const ampm = hours >= 12 ? 'PM' : 'AM';
    return `${hour}:${minutes.toString().padStart(2, '0')} ${ampm}`;
  } catch (error) {
    console.error('Error formatting time:', error);
    return timeStr;
  }
};

// Owner confirmation email template
const generateOwnerConfirmationEmail = (walkthrough: any, contactInfo: any, employees: any[], companyInfo: any, timezone: string = 'UTC'): string => {
  const employeeNames = employees.map(e => `${e.first_name} ${e.last_name}`).join(', ');

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
  <h1 style="margin:10px 0 0 0;font-size:22px">${companyInfo.company_name || 'Thunder Pro'} Cleaning Services</h1>
  <p style="margin:5px 0">Walkthrough Confirmation</p>
</div>

<div style="padding:15px">

<div style="background:#dcfce7;border-left:4px solid #10b981;padding:12px;margin:20px 0">
<p style="margin:0;font-size:14px;font-weight:bold;color:#065f46">✅ Walkthrough successfully scheduled</p>
</div>

<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Walkthrough Details</h3>
<div style="border-top:1px solid #1e3a8a;margin-bottom:12px"></div>
<p>
<strong>Date:</strong> ${formatDate(walkthrough.scheduled_date)}<br>
<strong>Time:</strong> ${formatTime(walkthrough.scheduled_time)}<br>
<strong>Service Type:</strong> ${walkthrough.service_type === 'residential' ? 'Residential' : 'Commercial'}<br>
<strong>Status:</strong> ${walkthrough.status}
</p>

${walkthrough.duration ? `<p><strong>Duration:</strong> ${walkthrough.duration} minutes</p>` : ''}
${walkthrough.notes ? `<p><strong>Notes:</strong> ${walkthrough.notes}</p>` : ''}

<h3 style="color:#1e3a8a;margin:20px 0 8px 0">${walkthrough.walkthrough_type === 'client' ? 'Client' : 'Lead'} Information</h3>
<div style="border-top:1px solid #1e3a8a;margin-bottom:12px"></div>
<p>
<strong>Name:</strong> ${contactInfo.full_name || contactInfo.lead_name}<br>
<strong>Phone:</strong> ${contactInfo.phone}<br>
<strong>Email:</strong> ${contactInfo.email}<br>
${contactInfo.service_street ? `<strong>Address:</strong> ${contactInfo.service_street}${contactInfo.service_apt ? `, ${contactInfo.service_apt}` : ''}, ${contactInfo.service_city}, ${contactInfo.service_state} ${contactInfo.service_zip} <a href="https://maps.google.com/?q=${encodeURIComponent(contactInfo.service_street + (contactInfo.service_apt ? ', ' + contactInfo.service_apt : '') + ', ' + contactInfo.service_city + ', ' + contactInfo.service_state + ' ' + contactInfo.service_zip)}" style="display:inline-block;background:#3b82f6;color:white;padding:4px 10px;text-decoration:none;border-radius:4px;font-size:12px;margin-left:8px">📍 Navigate</a>` : ''}
${contactInfo.street ? `<strong>Address:</strong> ${contactInfo.street}${contactInfo.apt_suite ? `, ${contactInfo.apt_suite}` : ''}, ${contactInfo.city}, ${contactInfo.state} ${contactInfo.zip_code} <a href="https://maps.google.com/?q=${encodeURIComponent(contactInfo.street + (contactInfo.apt_suite ? ', ' + contactInfo.apt_suite : '') + ', ' + contactInfo.city + ', ' + contactInfo.state + ' ' + contactInfo.zip_code)}" style="display:inline-block;background:#3b82f6;color:white;padding:4px 10px;text-decoration:none;border-radius:4px;font-size:12px;margin-left:8px">📍 Navigate</a>` : ''}
</p>

${employees.length > 0 ? `
<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Assigned Team</h3>
<div style="border-top:1px solid #1e3a8a;margin-bottom:12px"></div>
<p>${employeeNames}</p>
` : ''}

<div style="background:#eff6ff;border-left:4px solid #3b82f6;padding:12px;margin:20px 0">
<p style="margin:0;font-size:13px;color:#1e40af">📋 This walkthrough will help you prepare an accurate estimate for your client.</p>
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

// Client/Lead confirmation email template
const generateContactConfirmationEmail = (walkthrough: any, contactInfo: any, companyInfo: any, timezone: string = 'UTC'): string => {
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
  <h1 style="margin:0;font-size:22px">${companyInfo.company_name || 'Thunder Pro'} Cleaning Services</h1>
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

${contactInfo.service_street ? `
<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Location</h3>
<div style="border-top:1px solid #1e3a8a;margin-bottom:12px"></div>
<p>${contactInfo.service_street}${contactInfo.service_apt ? `, ${contactInfo.service_apt}` : ''}<br>
${contactInfo.service_city}, ${contactInfo.service_state} ${contactInfo.service_zip}</p>
` : ''}

${contactInfo.street ? `
<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Location</h3>
<div style="border-top:1px solid #1e3a8a;margin-bottom:12px"></div>
<p>${contactInfo.street}${contactInfo.apt_suite ? `, ${contactInfo.apt_suite}` : ''}<br>
${contactInfo.city}, ${contactInfo.state} ${contactInfo.zip_code}</p>
` : ''}

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
  console.log(`📧 Subject: ${subject}`);

  const smtpHost = "email-smtp.us-east-2.amazonaws.com";
  const smtpPort = 587;
  const smtpUser = Deno.env.get('AWS_SES_SMTP_USERNAME') || '';
  const smtpPass = Deno.env.get('AWS_SES_SMTP_PASSWORD') || '';
  const fromEmail = '"Thunder Pro" <info@thunderpro.co>';

  // Validate SMTP credentials
  if (!smtpUser || !smtpPass) {
    throw new Error('AWS SES SMTP credentials are missing. Check AWS_SES_SMTP_USERNAME and AWS_SES_SMTP_PASSWORD environment variables.');
  }

  console.log(`📧 SMTP Host: ${smtpHost}:${smtpPort}`);
  console.log(`📧 From: ${fromEmail}`);

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
      logCommand: boolean = false
    ): Promise<string> => {
      const commandToLog = logCommand ? command.substring(0, 20) + '...' : command;
      if (logCommand) {
        console.log(`📧 SMTP Command: ${commandToLog}`);
      }
      await connection.write(encoder.encode(command + '\r\n'));
      const response = await readResponse(connection);
      const responseCode = response.substring(0, 3);
      if (logCommand) {
        console.log(`📧 SMTP Response: ${response.trim()}`);
      }
      if (responseCode.startsWith('4') || responseCode.startsWith('5')) {
        throw new Error(`SMTP Error ${responseCode}: ${response.trim()}`);
      }
      return response;
    };

    console.log('📧 Connecting to SMTP server...');
    await readResponse(conn);
    console.log('📧 SMTP connection established');
    
    await sendCommand(conn, 'EHLO thunderpro.co', true);
    await sendCommand(conn, 'STARTTLS', true);
    console.log('📧 Upgrading to TLS...');
    tlsConn = await Deno.startTls(conn, { hostname: smtpHost });
    console.log('📧 TLS connection established');
    
    await sendCommand(tlsConn, 'EHLO thunderpro.co', true);
    console.log('📧 Authenticating...');
    await tlsConn.write(encoder.encode('AUTH LOGIN\r\n'));
    await readResponse(tlsConn);
    await sendCommand(tlsConn, btoa(smtpUser), true);
    await sendCommand(tlsConn, btoa(smtpPass), true);
    console.log('📧 Authentication successful');
    
    await sendCommand(tlsConn, `MAIL FROM:<info@thunderpro.co>`, true);
    await sendCommand(tlsConn, `RCPT TO:<${toEmail}>`, true);
    await sendCommand(tlsConn, 'DATA', true);

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
    console.log(`📧 SMTP DATA response: ${dataResponse.trim()}`);
    
    // Check if the DATA command was successful (250 response code)
    const dataResponseCode = dataResponse.substring(0, 3);
    if (!dataResponseCode.startsWith('2')) {
      throw new Error(`SMTP DATA command failed: ${dataResponse.trim()}`);
    }
    
    await sendCommand(tlsConn, 'QUIT');
    tlsConn.close();

    console.log(`✅ Email sent successfully to ${toEmail}`);

  } catch (error: any) {
    console.error(`❌ SMTP Error sending to ${toEmail}:`, error.message);
    try {
      if (tlsConn) tlsConn.close();
      if (conn) conn.close();
    } catch { }
    throw error;
  }
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { walkthroughId } = await req.json();

    console.log('📋 Processing walkthrough confirmation for ID:', walkthroughId);

    if (!walkthroughId) {
      throw new Error('Missing walkthroughId');
    }

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

    console.log('✅ Walkthrough found:', walkthrough);

    // Get company info and timezone
    const { data: companyInfo } = await supabaseClient
      .from('profiles')
      .select('company_name, company_email, company_phone, timezone')
      .eq('user_id', walkthrough.user_id)
      .maybeSingle();

    const userTimezone = companyInfo?.timezone || 'UTC';
    console.log('✅ Company info:', companyInfo);
    console.log('✅ User timezone:', userTimezone);

    // Get employees
    const employeeIds = Array.isArray(walkthrough.assigned_employees) ? walkthrough.assigned_employees : [];
    let employees: any[] = [];
    if (employeeIds.length > 0) {
      const { data: employeeData } = await supabaseClient
        .from('employees')
        .select('id, first_name, last_name')
        .in('id', employeeIds);
      employees = employeeData || [];
    }

    // Get client or lead information
    let contactInfo: any = null;

    if (walkthrough.walkthrough_type === 'client' && walkthrough.client_id) {
      const { data: client } = await supabaseClient
        .from('clients')
        .select('*')
        .eq('id', walkthrough.client_id)
        .single();
      contactInfo = client;
      console.log('✅ Client info:', client);
    } else if (walkthrough.walkthrough_type === 'lead' && walkthrough.lead_id) {
      // Try leads table first
      const { data: lead } = await supabaseClient
        .from('leads')
        .select('*')
        .eq('id', walkthrough.lead_id)
        .maybeSingle();

      if (lead) {
        contactInfo = lead;
        console.log('✅ Lead info from leads table:', lead);
      } else {
        // Try bookings table
        const { data: booking } = await supabaseClient
          .from('bookings')
          .select('*')
          .eq('id', walkthrough.lead_id)
          .maybeSingle();
        contactInfo = booking;
        console.log('✅ Lead info from bookings table:', booking);
      }
    }

    if (!contactInfo) {
      throw new Error('Contact information not found');
    }

    let ownerEmailSent = false;
    let clientEmailSent = false;

    // Send email to owner
    if (companyInfo?.company_email) {
      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(companyInfo.company_email)) {
        console.error('❌ Invalid company email address format:', companyInfo.company_email);
        console.warn('⚠️ Skipping owner email send due to invalid email format');
      } else {
        console.log('📧 Sending confirmation to owner:', companyInfo.company_email);
        try {
          await sendEmailViaSMTP(
            companyInfo.company_email,
            'Walkthrough confirmed',
            generateOwnerConfirmationEmail(walkthrough, contactInfo, employees, companyInfo, userTimezone)
          );
          ownerEmailSent = true;
          console.log('✅ Owner confirmation email sent successfully to:', companyInfo.company_email);
        } catch (error: any) {
          console.error('❌ Failed to send owner email:', error.message);
          console.error('❌ Full error:', error);
          // Don't throw for owner email - continue with client email
        }
      }
    } else {
      console.warn('⚠️ No company email found - owner email not sent');
    }

    // Send email to client/lead
    if (contactInfo.email) {
      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(contactInfo.email)) {
        console.error('❌ Invalid email address format:', contactInfo.email);
        console.warn('⚠️ Skipping email send due to invalid email format');
      } else {
        console.log('📧 Sending confirmation to contact:', contactInfo.email);
        try {
          await sendEmailViaSMTP(
            contactInfo.email,
            'Walkthrough confirmed',
            generateContactConfirmationEmail(walkthrough, contactInfo, companyInfo || {}, userTimezone)
          );
          clientEmailSent = true;
          console.log('✅ Client/lead confirmation email sent successfully to:', contactInfo.email);
        } catch (error: any) {
          console.error('❌ Failed to send client/lead email:', error.message);
          console.error('❌ Full error:', error);
          // Re-throw to be caught by outer handler
          throw new Error(`Failed to send email to ${contactInfo.email}: ${error.message}`);
        }
      }
    } else {
      console.warn('⚠️ No email address found for contact. Contact info:', {
        type: walkthrough.walkthrough_type,
        clientId: walkthrough.client_id,
        leadId: walkthrough.lead_id,
        hasEmail: !!contactInfo.email,
        contactName: contactInfo.full_name || contactInfo.lead_name
      });
    }

    // Track that confirmation was sent
    await supabaseClient
      .from('walkthrough_reminders_sent')
      .insert({
        walkthrough_id: walkthroughId,
        reminder_type: 'confirmation'
      });

    const responseMessage = clientEmailSent 
      ? 'Confirmation emails sent successfully'
      : ownerEmailSent 
        ? 'Owner email sent, but client/lead email was not sent (no email address)'
        : 'Some emails failed to send';

    console.log('✅ Confirmation process completed:', { ownerEmailSent, clientEmailSent });

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
    console.error('❌ Error in send-walkthrough-confirmation:', error);
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
