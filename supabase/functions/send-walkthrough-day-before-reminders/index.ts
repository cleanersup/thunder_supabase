import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.76.1';
import * as Sentry from "npm:@sentry/deno";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Sentry.init({
  dsn: "https://ce035a76b6157a602d88c53eab6570e4@o4509804047958016.ingest.us.sentry.io/4510552540971008",
  environment: Deno.env.get("SUPABASE_URL")?.includes("staging") ? "staging" : "production",
  tracesSampleRate: 0.1,
});

// Normalize phone number: add +1 prefix if not present
const normalizePhoneNumber = (phone: string): string => {
  const cleaned = phone.replace(/[^\d+]/g, '');
  if (cleaned.startsWith('+1')) {
    return cleaned;
  }
  const digits = cleaned.startsWith('+') ? cleaned.slice(1) : cleaned;
  return `+1${digits}`;
};

// Format date in user's timezone (e.g., "Jan 25")
const formatDateShort = (dateStr: string, timezone: string): string => {
  const [year, month, day] = dateStr.split('-').map(Number);
  const dateAtMidday = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: timezone
  }).format(dateAtMidday);
};

// Format time (e.g., "10:00 AM")
const formatTime = (timeStr: string): string => {
  if (!timeStr) return 'Not specified';
  const [hours, minutes] = timeStr.split(':');
  const hour = parseInt(hours);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${minutes.toString().padStart(2, '0')} ${ampm}`;
};

// Format date in full format (e.g., "January 25, 2026")
const formatDateFull = (dateStr: string, timezone: string): string => {
  const [year, month, day] = dateStr.split('-').map(Number);
  const dateAtMidday = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: timezone
  }).format(dateAtMidday);
};

// Owner reminder email template (1 day before)
const generateOwnerReminderEmail = (walkthrough: any, contactInfo: any, employees: any[], companyInfo: any, timezone: string): string => {
  const employeeNames = employees.map(e => `${e.first_name} ${e.last_name}`).join(', ');
  const contactName = contactInfo.full_name || contactInfo.lead_name;
  const formattedDate = formatDateFull(walkthrough.scheduled_date, timezone);
  const formattedTime = formatTime(walkthrough.scheduled_time);
  
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
  <p style="margin:5px 0">Walkthrough Reminder - Tomorrow</p>
</div>

<div style="padding:15px">

<p style="font-size:16px;color:#1e3a8a">Hi,</p>

<div style="background:#fef3c7;border-left:4px solid #f59e0b;padding:12px;margin:20px 0">
<p style="margin:0;font-size:16px;font-weight:bold;color:#92400e">📅 Walkthrough scheduled for tomorrow!</p>
</div>

<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Walkthrough Details</h3>
<div style="border-top:1px solid #1e3a8a;margin-bottom:12px"></div>
<p>
<strong>Date:</strong> ${formattedDate}<br>
<strong>Time:</strong> ${formattedTime}<br>
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
<p style="margin:0;font-size:13px;color:#1e40af">💼 Don't forget to prepare: measuring tools, camera, notepad, and business cards.</p>
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

// Client/Lead reminder email template (1 day before)
const generateContactReminderEmail = (walkthrough: any, contactInfo: any, companyInfo: any, timezone: string): string => {
  const contactName = contactInfo.full_name || contactInfo.lead_name;
  const formattedDate = formatDateFull(walkthrough.scheduled_date, timezone);
  const formattedTime = formatTime(walkthrough.scheduled_time);
  
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

<p style="font-size:16px;color:#1e3a8a">Dear ${contactName},</p>

<div style="background:#dcfce7;border-left:4px solid #10b981;padding:12px;margin:20px 0">
<p style="margin:0;font-size:16px;font-weight:bold;color:#065f46">📅 Friendly reminder: Your walkthrough is scheduled for tomorrow!</p>
</div>

<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Appointment Details</h3>
<div style="border-top:1px solid #1e3a8a;margin-bottom:12px"></div>
<p>
<strong>Date:</strong> ${formattedDate}<br>
<strong>Time:</strong> ${formattedTime}<br>
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
<p style="margin:0;font-size:13px;color:#1e40af">📞 If you need to reschedule or have any questions, please contact us at ${companyInfo.company_phone || companyInfo.company_email || 'our office'}.</p>
</div>

<p>We look forward to meeting you tomorrow!</p>

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

// Send SMS via Twilio
async function sendSMSViaTwilio(
  phoneNumber: string,
  message: string
): Promise<string> {
  const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID');
  const authToken = Deno.env.get('TWILIO_AUTH_TOKEN');
  const twilioPhone = Deno.env.get('TWILIO_PHONE_NUMBER');

  if (!accountSid || !authToken || !twilioPhone) {
    throw new Error('Missing Twilio credentials');
  }

  const normalizedPhone = normalizePhoneNumber(phoneNumber);
  const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;

  console.log(`📱 Sending SMS to: ${normalizedPhone}`);
  console.log(`📱 SMS message: ${message}`);

  const response = await fetch(twilioUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + btoa(`${accountSid}:${authToken}`),
    },
    body: new URLSearchParams({
      To: normalizedPhone,
      From: twilioPhone,
      Body: message,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || data.error_message || 'Failed to send SMS');
  }

  console.log(`✅ SMS sent successfully: ${data.sid}`);
  return data.sid;
}

const handler = async (req: Request): Promise<Response> => {
  return await Sentry.withScope(async (scope) => {
    Sentry.setTag("function", "send-walkthrough-day-before-reminders");

    if (req.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      console.log('📅 Starting 1-day-before walkthrough reminder check...');

      const supabaseClient = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
      );

      // Calculate tomorrow's date in YYYY-MM-DD format
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowDate = tomorrow.toISOString().split('T')[0];
      
      console.log(`📅 Looking for walkthroughs scheduled for: ${tomorrowDate}`);

      // Get all walkthroughs scheduled for tomorrow
      const { data: walkthroughs, error: wtError } = await supabaseClient
        .from('walkthroughs')
        .select('*')
        .eq('scheduled_date', tomorrowDate)
        .eq('status', 'Scheduled');

      if (wtError) {
        console.error('Error fetching walkthroughs:', wtError);
        throw wtError;
      }

      console.log(`📋 Found ${walkthroughs?.length || 0} walkthroughs scheduled for tomorrow`);

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
            .eq('reminder_type', '1d')
            .maybeSingle();

          if (alreadySent) {
            console.log(`⏭️ Reminder already sent for walkthrough ${walkthrough.id}`);
            continue;
          }

          // Get user's timezone from profiles table
          const { data: userProfile } = await supabaseClient
            .from('profiles')
            .select('timezone, company_name, company_email, company_phone')
            .eq('user_id', walkthrough.user_id)
            .maybeSingle();
          
          const userTimezone = userProfile?.timezone || 'America/New_York';
          const companyInfo = {
            company_name: userProfile?.company_name || 'Thunder Pro',
            company_email: userProfile?.company_email,
            company_phone: userProfile?.company_phone,
          };

          console.log(`🌍 User timezone: ${userTimezone}`);

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

          // Format employee name(s) for SMS
          let employeeName = 'our team';
          if (employees.length === 1) {
            employeeName = `${employees[0].first_name} ${employees[0].last_name}`;
          } else if (employees.length > 1) {
            employeeName = `${employees[0].first_name} ${employees[0].last_name}`;
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
            const { data: lead } = await supabaseClient
              .from('leads')
              .select('*')
              .eq('id', walkthrough.lead_id)
              .maybeSingle();
            
            if (lead) {
              contactInfo = lead;
            } else {
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

          // Format date and time for messages
          const formattedDate = formatDateShort(walkthrough.scheduled_date, userTimezone);
          const formattedTime = formatTime(walkthrough.scheduled_time);

          // Format duration
          let durationText = '';
          if (walkthrough.duration) {
            const durationMinutes = walkthrough.duration;
            if (durationMinutes >= 60) {
              const hours = Math.floor(durationMinutes / 60);
              const minutes = durationMinutes % 60;
              if (minutes > 0) {
                durationText = ` (${hours}h ${minutes}m)`;
              } else {
                durationText = ` (${hours}h)`;
              }
            } else {
              durationText = ` (${durationMinutes}m)`;
            }
          }

          // Send email to owner
          if (companyInfo.company_email) {
            console.log(`📧 Sending reminder email to owner: ${companyInfo.company_email}`);
            await sendEmailViaSMTP(
              companyInfo.company_email,
              'Walkthrough reminder - Tomorrow',
              generateOwnerReminderEmail(walkthrough, contactInfo, employees, companyInfo, userTimezone)
            );
          }

          // Send SMS to owner (if phone available)
          if (companyInfo.company_phone) {
            try {
              const ownerMessage = `Reminder: Walkthrough with ${contactInfo.full_name || contactInfo.lead_name} scheduled for tomorrow (${formattedDate}) at ${formattedTime}${durationText}`;
              await sendSMSViaTwilio(companyInfo.company_phone, ownerMessage);
            } catch (smsError: any) {
              console.error(`⚠️ Failed to send SMS to owner:`, smsError.message);
            }
          }

          // Send email to client/lead
          if (contactInfo.email) {
            console.log(`📧 Sending reminder email to contact: ${contactInfo.email}`);
            await sendEmailViaSMTP(
              contactInfo.email,
              'Walkthrough reminder - Tomorrow',
              generateContactReminderEmail(walkthrough, contactInfo, companyInfo, userTimezone)
            );
          }

          // Send SMS to client/lead
          if (contactInfo.phone) {
            try {
              const clientMessage = `A New walkthrough is schedule with ${employeeName} on ${formattedDate} at ${formattedTime}${durationText}`;
              await sendSMSViaTwilio(contactInfo.phone, clientMessage);
            } catch (smsError: any) {
              console.error(`⚠️ Failed to send SMS to contact:`, smsError.message);
            }
          }

          // Mark reminder as sent
          await supabaseClient
            .from('walkthrough_reminders_sent')
            .insert({
              walkthrough_id: walkthrough.id,
              reminder_type: '1d'
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
      Sentry.captureException(error);
      console.error('❌ Error in send-walkthrough-day-before-reminders:', error);
      return new Response(
        JSON.stringify({ error: error.message }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        }
      );
    }
  });
};

serve(handler);
