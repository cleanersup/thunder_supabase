import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.76.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Helper to format date
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

// Helper to format time
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

// Owner update email template
const generateOwnerUpdateEmail = (walkthrough: any, contactInfo: any, employees: any[], companyInfo: any, timezone: string = 'UTC'): string => {
  const employeeNames = employees.length > 0 
    ? employees.map(e => `${e.first_name} ${e.last_name}`).join(', ')
    : 'Not assigned';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:20px;font-family:Arial,sans-serif">
<div style="max-width:600px;margin:0 auto">

<div style="text-align:center;padding:15px;background:#f59e0b;color:white">
  <p style="margin:0;font-size:14px;font-weight:bold;background:#d97706;padding:8px;border-radius:4px">OWNER COPY - INTERNAL USE ONLY</p>
  <h1 style="margin:10px 0 0 0;font-size:22px">${companyInfo.company_name || 'Thunder Pro'} Cleaning Services</h1>
  <p style="margin:5px 0">Walkthrough Updated</p>
</div>

<div style="padding:15px">

<div style="background:#fef3c7;border-left:4px solid #f59e0b;padding:12px;margin:20px 0">
<p style="margin:0;font-size:14px;font-weight:bold;color:#92400e">🔄 Walkthrough has been rescheduled/updated</p>
</div>

<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Updated Walkthrough Details</h3>
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
<strong>Phone:</strong> ${contactInfo.phone || 'N/A'}<br>
<strong>Email:</strong> ${contactInfo.email || 'N/A'}<br>
${contactInfo.service_street ? `<strong>Address:</strong> ${contactInfo.service_street}${contactInfo.service_apt ? `, ${contactInfo.service_apt}` : ''}, ${contactInfo.service_city}, ${contactInfo.service_state} ${contactInfo.service_zip} <a href="https://maps.google.com/?q=${encodeURIComponent(contactInfo.service_street + (contactInfo.service_apt ? ', ' + contactInfo.service_apt : '') + ', ' + contactInfo.service_city + ', ' + contactInfo.service_state + ' ' + contactInfo.service_zip)}" style="display:inline-block;background:#3b82f6;color:white;padding:4px 10px;text-decoration:none;border-radius:4px;font-size:12px;margin-left:8px">📍 Navigate</a>` : ''}
${contactInfo.street ? `<strong>Address:</strong> ${contactInfo.street}${contactInfo.apt_suite ? `, ${contactInfo.apt_suite}` : ''}, ${contactInfo.city}, ${contactInfo.state} ${contactInfo.zip_code} <a href="https://maps.google.com/?q=${encodeURIComponent(contactInfo.street + (contactInfo.apt_suite ? ', ' + contactInfo.apt_suite : '') + ', ' + contactInfo.city + ', ' + contactInfo.state + ' ' + contactInfo.zip_code)}" style="display:inline-block;background:#3b82f6;color:white;padding:4px 10px;text-decoration:none;border-radius:4px;font-size:12px;margin-left:8px">📍 Navigate</a>` : ''}
</p>

${employees.length > 0 ? `
<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Assigned Team</h3>
<div style="border-top:1px solid #1e3a8a;margin-bottom:12px"></div>
<p>${employeeNames}</p>
` : ''}

<div style="background:#eff6ff;border-left:4px solid #3b82f6;padding:12px;margin:20px 0">
<p style="margin:0;font-size:13px;color:#1e40af">📋 Please note the updated walkthrough details above.</p>
</div>

</div>

<div style="text-align:center;padding:15px;background:#1e3a8a;color:white">
  <p style="margin:0 0 5px 0;font-size:12px">Service provided by</p>
  <p style="margin:0">© ${new Date().getFullYear()} Thunder Pro Inc. | <a href="https://www.thunderpro.co" style="color:white">www.thunderpro.co</a></p>
</div>

</div>
</body>
</html>`;
};

// Client/Lead update email template
const generateContactUpdateEmail = (walkthrough: any, contactInfo: any, companyInfo: any, timezone: string = 'UTC'): string => {
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
  <p style="margin:5px 0">Walkthrough Appointment Updated</p>
</div>

<div style="padding:15px">

<p style="font-size:16px;color:#1e3a8a">Dear ${contactName},</p>

<div style="background:#fef3c7;border-left:4px solid #f59e0b;padding:12px;margin:20px 0">
<p style="margin:0;font-size:16px;font-weight:bold;color:#92400e">🔄 Your walkthrough appointment has been updated</p>
</div>

<p style="font-size:14px;line-height:1.6;margin:15px 0">
  We wanted to inform you that your walkthrough appointment has been rescheduled. Please see the updated details below.
</p>

<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Updated Appointment Details</h3>
<div style="border-top:1px solid #1e3a8a;margin-bottom:12px"></div>
<p>
<strong>Date:</strong> ${formatDate(walkthrough.scheduled_date)}<br>
<strong>Time:</strong> ${formatTime(walkthrough.scheduled_time)}<br>
<strong>Service Type:</strong> ${walkthrough.service_type === 'residential' ? 'Residential Cleaning' : 'Commercial Cleaning'}
</p>

${walkthrough.duration ? `<p><strong>Duration:</strong> ${walkthrough.duration} minutes</p>` : ''}

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

<div style="background:#eff6ff;border-left:4px solid #3b82f6;padding:12px;margin:20px 0">
<p style="margin:0;font-size:13px;color:#1e40af">📞 If you have any questions or need to make further changes, please contact us at ${companyInfo.company_phone || 'Company Phone Number'}.</p>
</div>

<p style="font-size:14px;line-height:1.6;margin:20px 0">
  We look forward to meeting with you!
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
  console.log('=== STARTING SMTP EMAIL PROCESS ===');
  console.log('📧 To:', toEmail);
  console.log('📧 Subject:', subject);
  
  const smtpHost = "email-smtp.us-east-2.amazonaws.com";
  const smtpPort = 587;
  const smtpUser = Deno.env.get('AWS_SES_SMTP_USERNAME');
  const smtpPass = Deno.env.get('AWS_SES_SMTP_PASSWORD');
  const fromEmail = Deno.env.get('AWS_SES_FROM_EMAIL') || '"Thunder Pro" <info@thunderpro.co>';

  // Extract just the email address for MAIL FROM command (SMTP doesn't accept display names)
  let fromEmailAddress = fromEmail;
  const emailMatch = fromEmail.match(/<([^>]+)>/);
  if (emailMatch) {
    fromEmailAddress = emailMatch[1];
  } else {
    fromEmailAddress = fromEmail.trim();
  }

  console.log('📧 SMTP Configuration:', {
    smtpHost,
    smtpPort,
    fromEmail,
    fromEmailAddress,
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
    
    const dataResponseCode = dataResponse.substring(0, 3);
    if (!dataResponseCode.startsWith('2')) {
      console.error('❌ DATA command failed:', dataResponse.trim());
      throw new Error(`SMTP DATA command failed: ${dataResponse.trim()}`);
    }
    
    console.log('[10/10] Sending QUIT...');
    await sendCommand(tlsConn, 'QUIT', '[10/10]');
    console.log('[10/10] ✓ QUIT sent');
    
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

    const { walkthroughId } = await req.json();

    if (!walkthroughId) {
      throw new Error('Walkthrough ID is required');
    }

    console.log('=== WALKTHROUGH UPDATE EMAIL PROCESS ===');
    console.log('Walkthrough ID:', walkthroughId);

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
        .select('full_name, company, phone, email, service_street, service_city, service_state, service_zip, service_apt')
        .eq('id', walkthrough.client_id)
        .single();
      contactInfo = client;
    } else if (walkthrough.walkthrough_type === 'lead' && walkthrough.lead_id) {
      const { data: lead } = await supabase
        .from('leads')
        .select('full_name, company_name, phone, email, address, city, state, zip_code, apt_suite')
        .eq('id', walkthrough.lead_id)
        .maybeSingle();

      if (lead) {
        contactInfo = {
          full_name: lead.full_name,
          lead_name: lead.full_name,
          company: lead.company_name,
          phone: lead.phone,
          email: lead.email,
          service_street: lead.address,
          service_city: lead.city,
          service_state: lead.state,
          service_zip: lead.zip_code,
          service_apt: lead.apt_suite,
          street: lead.address,
          city: lead.city,
          state: lead.state,
          zip_code: lead.zip_code,
          apt_suite: lead.apt_suite,
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
            lead_name: booking.lead_name,
            phone: booking.phone,
            email: booking.email,
            service_street: booking.street,
            street: booking.street,
            service_city: booking.city,
            city: booking.city,
            service_state: booking.state,
            state: booking.state,
            service_zip: booking.zip_code,
            zip_code: booking.zip_code,
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

    // Fetch assigned employees
    const employeeIds = Array.isArray(walkthrough.assigned_employees) ? walkthrough.assigned_employees : [];
    let employees: any[] = [];
    if (employeeIds.length > 0) {
      const { data: employeeData } = await supabase
        .from('employees')
        .select('id, first_name, last_name')
        .in('id', employeeIds);
      employees = employeeData || [];
    }

    const userTimezone = companyInfo?.timezone || 'UTC';
    console.log('User timezone:', userTimezone);

    let ownerEmailSent = false;
    let clientEmailSent = false;

    // Send email to owner
    const ownerEmail = companyInfo?.company_email || user.email || '';
    console.log('=== OWNER EMAIL ===');
    console.log('Owner email address:', ownerEmail);
    
    if (!ownerEmail) {
      console.warn('⚠️ No owner email address found - skipping owner email');
    } else {
      try {
        const ownerEmailHtml = generateOwnerUpdateEmail(walkthrough, contactInfo, employees, companyInfo || {}, userTimezone);
        console.log('Sending owner update email...');
        await sendEmailViaSMTP(
          ownerEmail,
          'Walkthrough Appointment Updated',
          ownerEmailHtml
        );
        ownerEmailSent = true;
        console.log('✅ Owner update email sent successfully to:', ownerEmail);
      } catch (error: any) {
        console.error('❌ Failed to send owner update email:', error.message);
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
        const clientEmailHtml = generateContactUpdateEmail(walkthrough, contactInfo, companyInfo || {}, userTimezone);
        console.log('Sending client update email...');
        await sendEmailViaSMTP(
          clientEmail,
          'Walkthrough Appointment Updated',
          clientEmailHtml
        );
        clientEmailSent = true;
        console.log('✅ Client update email sent successfully to:', clientEmail);
      } catch (error: any) {
        console.error('❌ Failed to send client update email:', error.message);
      }
    }

    const responseMessage = clientEmailSent && ownerEmailSent
      ? 'Update emails sent successfully'
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
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );

  } catch (error: any) {
    console.error('❌ Error in send-walkthrough-update:', error);
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
