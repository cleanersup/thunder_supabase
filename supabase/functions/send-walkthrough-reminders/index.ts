import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.76.1';
import { toZonedTime, fromZonedTime } from 'https://esm.sh/date-fns-tz@3.2.0';

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

// Owner reminder email template
const generateOwnerReminderEmail = (walkthrough: any, contactInfo: any, employees: any[], companyInfo: any, timezone: string = 'UTC'): string => {
  const employeeNames = employees.map(e => `${e.first_name} ${e.last_name}`).join(', ');
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
<strong>Today at:</strong> ${formatTime(walkthrough.scheduled_time)}<br>
<strong>Service Type:</strong> ${walkthrough.service_type === 'residential' ? 'Residential' : 'Commercial'}<br>
<strong>${walkthrough.walkthrough_type === 'client' ? 'Client' : 'Lead'}:</strong> ${contactName}
</p>

${contactInfo.service_street ? `
<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Location</h3>
<div style="border-top:1px solid #1e3a8a;margin-bottom:12px"></div>
<p>
${contactInfo.service_street}${contactInfo.service_apt ? `, ${contactInfo.service_apt}` : ''}<br>
${contactInfo.service_city}, ${contactInfo.service_state} ${contactInfo.service_zip} <a href="https://maps.google.com/?q=${encodeURIComponent(contactInfo.service_street + (contactInfo.service_apt ? ', ' + contactInfo.service_apt : '') + ', ' + contactInfo.service_city + ', ' + contactInfo.service_state + ' ' + contactInfo.service_zip)}" style="display:inline-block;background:#3b82f6;color:white;padding:4px 10px;text-decoration:none;border-radius:4px;font-size:12px;margin-left:8px">📍 Navigate</a><br>
<strong>Phone:</strong> ${contactInfo.phone}
</p>
` : ''}

${contactInfo.street ? `
<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Location</h3>
<div style="border-top:1px solid #1e3a8a;margin-bottom:12px"></div>
<p>
${contactInfo.street}${contactInfo.apt_suite ? `, ${contactInfo.apt_suite}` : ''}<br>
${contactInfo.city}, ${contactInfo.state} ${contactInfo.zip_code} <a href="https://maps.google.com/?q=${encodeURIComponent(contactInfo.street + (contactInfo.apt_suite ? ', ' + contactInfo.apt_suite : '') + ', ' + contactInfo.city + ', ' + contactInfo.state + ' ' + contactInfo.zip_code)}" style="display:inline-block;background:#3b82f6;color:white;padding:4px 10px;text-decoration:none;border-radius:4px;font-size:12px;margin-left:8px">📍 Navigate</a><br>
<strong>Phone:</strong> ${contactInfo.phone}
</p>
` : ''}

${employees.length > 0 ? `
<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Assigned Team</h3>
<div style="border-top:1px solid #1e3a8a;margin-bottom:12px"></div>
<p>${employeeNames}</p>
` : ''}

${walkthrough.notes ? `
<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Notes</h3>
<div style="border-top:1px solid #1e3a8a;margin-bottom:12px"></div>
<p>${walkthrough.notes}</p>
` : ''}

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
};

// Client/Lead reminder email template
const generateContactReminderEmail = (walkthrough: any, contactInfo: any, companyInfo: any, timezone: string = 'UTC'): string => {
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
  <p style="margin:5px 0">We're On Our Way!</p>
</div>

<div style="padding:15px">

<p style="font-size:16px;color:#1e3a8a">Dear ${contactName},</p>

<div style="background:#dcfce7;border-left:4px solid #10b981;padding:12px;margin:20px 0">
<p style="margin:0;font-size:16px;font-weight:bold;color:#065f46">🚗 Our team will arrive in approximately 1 hour!</p>
</div>

<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Appointment Details</h3>
<div style="border-top:1px solid #1e3a8a;margin-bottom:12px"></div>
<p>
<strong>Today at:</strong> ${formatTime(walkthrough.scheduled_time)}<br>
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

<h3 style="color:#1e3a8a;margin:20px 0 8px 0">What We'll Do</h3>
<div style="border-top:1px solid #1e3a8a;margin-bottom:12px"></div>
<ul style="color:#4b5563;line-height:1.8">
  <li>Assess your property's cleaning requirements</li>
  <li>Take measurements and photographs</li>
  <li>Answer all your questions</li>
  <li>Provide you with a detailed estimate</li>
</ul>

<div style="background:#eff6ff;border-left:4px solid #3b82f6;padding:12px;margin:20px 0">
<p style="margin:0;font-size:13px;color:#1e40af">📞 If you need to contact us before we arrive, please call ${companyInfo.company_phone || companyInfo.company_email || 'our office'}.</p>
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
    console.log('⏰ Starting walkthrough reminder check...');

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const now = new Date();
    console.log(`🕐 Current UTC time: ${now.toISOString()}`);

    // Get all scheduled walkthroughs for today
    const todayDate = now.toISOString().split('T')[0];
    
    const { data: walkthroughs, error: wtError } = await supabaseClient
      .from('walkthroughs')
      .select('*')
      .eq('scheduled_date', todayDate)
      .eq('status', 'Scheduled');

    if (wtError) {
      console.error('Error fetching walkthroughs:', wtError);
      throw wtError;
    }

    console.log(`📋 Found ${walkthroughs?.length || 0} scheduled walkthroughs today`);

    if (!walkthroughs || walkthroughs.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: 'No walkthroughs to remind', sent: 0 }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        }
      );
    }

    let remindersSent = 0;

    for (const walkthrough of walkthroughs) {
      try {
        console.log(`\n📋 Processing walkthrough ${walkthrough.id}`);

        // Check if reminder already sent
        const { data: alreadySent } = await supabaseClient
          .from('walkthrough_reminders_sent')
          .select('id')
          .eq('walkthrough_id', walkthrough.id)
          .eq('reminder_type', '1h')
          .maybeSingle();

        if (alreadySent) {
          console.log(`⏭️ Reminder already sent for walkthrough ${walkthrough.id}`);
          continue;
        }

        // Get user's timezone from profiles table
        const { data: userProfile } = await supabaseClient
          .from('profiles')
          .select('timezone')
          .eq('user_id', walkthrough.user_id)
          .maybeSingle();
        
        const userTimezone = userProfile?.timezone || 'America/New_York';
        console.log(`🌍 User timezone: ${userTimezone}`);

        // Parse scheduled time
        const scheduledDateStr = `${walkthrough.scheduled_date}T${walkthrough.scheduled_time}`;
        console.log(`📅 Input date/time string: ${scheduledDateStr}`);
        
        // Create a date object treating the date/time as if it's in the user's timezone
        // We parse it without timezone info, then convert from user's TZ to UTC
        const dateParts = walkthrough.scheduled_date.split('-').map(Number);
        const timeParts = walkthrough.scheduled_time.split(':').map(Number);
        
        // Create date in user's timezone (this represents the local time)
        const localDate = new Date(dateParts[0], dateParts[1] - 1, dateParts[2], timeParts[0], timeParts[1], timeParts[2] || 0);
        
        // Convert from user's timezone to UTC
        const scheduledDateTimeUTC = fromZonedTime(localDate, userTimezone);
        console.log(`📅 Scheduled time in ${userTimezone}: ${localDate.toLocaleString()}`);
        console.log(`📅 Scheduled time in UTC: ${scheduledDateTimeUTC.toISOString()}`);

        // Calculate 1 hour before in UTC
        const oneHourBefore = new Date(scheduledDateTimeUTC.getTime() - 60 * 60 * 1000);
        console.log(`⏰ One hour before (UTC): ${oneHourBefore.toISOString()}`);

        // Check if we're within 10 minutes before or after the 1-hour mark
        // This gives us a 20-minute window since cron runs every 5 minutes
        const timeDiff = now.getTime() - oneHourBefore.getTime();
        const withinWindow = timeDiff >= -10 * 60 * 1000 && timeDiff <= 10 * 60 * 1000;

        console.log(`⏱️ Time diff: ${Math.round(timeDiff / 1000 / 60)} minutes, Within window: ${withinWindow}`);

        if (!withinWindow) {
          console.log(`⏭️ Not time yet for walkthrough ${walkthrough.id}`);
          continue;
        }

        // Get company info
        const { data: companyInfo } = await supabaseClient
          .from('profiles')
          .select('company_name, company_email, company_phone')
          .eq('user_id', walkthrough.user_id)
          .maybeSingle();

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
          console.log(`⚠️ No contact info found for walkthrough ${walkthrough.id}`);
          continue;
        }

        // Send email to owner
        if (companyInfo?.company_email) {
          console.log(`📧 Sending reminder to owner: ${companyInfo.company_email}`);
          await sendEmailViaSMTP(
            companyInfo.company_email,
            'The walkthrough starts in 1 hour.',
            generateOwnerReminderEmail(walkthrough, contactInfo, employees, companyInfo, userTimezone)
          );
        }

        // Send email to client/lead
        if (contactInfo.email) {
          console.log(`📧 Sending reminder to contact: ${contactInfo.email}`);
          await sendEmailViaSMTP(
            contactInfo.email,
            'The walkthrough starts in 1 hour.',
            generateContactReminderEmail(walkthrough, contactInfo, companyInfo || {}, userTimezone)
          );
        }

        // Mark reminder as sent
        await supabaseClient
          .from('walkthrough_reminders_sent')
          .insert({
            walkthrough_id: walkthrough.id,
            reminder_type: '1h'
          });

        remindersSent++;
        console.log(`✅ Reminders sent for walkthrough ${walkthrough.id}`);

      } catch (error: any) {
        console.error(`❌ Error processing walkthrough ${walkthrough.id}:`, error.message);
        // Continue with next walkthrough
      }
    }

    console.log(`\n✅ Process complete. Sent ${remindersSent} reminders.`);

    return new Response(
      JSON.stringify({ success: true, message: `Sent ${remindersSent} reminders`, sent: remindersSent }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      }
    );

  } catch (error: any) {
    console.error('❌ Error in send-walkthrough-reminders:', error);
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
