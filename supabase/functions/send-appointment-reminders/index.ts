import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.76.1';
import { toZonedTime, fromZonedTime } from 'https://esm.sh/date-fns-tz@3.2.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Get app URL from environment variables
const publicAppUrl = Deno.env.get("PUBLIC_APP_URL") || Deno.env.get("APP_URL") || "https://app.staging.thunderpro.co";

// Helper to format date in user's timezone
const formatDateInTimezone = (dateStr: string, timezone: string) => {
  const date = new Date(dateStr);
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: timezone
  }).format(date);
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

// 24-Hour Reminder Templates
const generate24hOwnerEmail = (appointment: any, client: any, employees: any[], companyInfo: any, userTimezone: string): string => {
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
  <h1 style="margin:0;font-size:22px">${companyInfo.company_name || 'Thunder Pro'}</h1>
  <p style="margin:5px 0">24-Hour Service Reminder</p>
</div>

<div style="padding:15px">

<p style="font-size:16px;color:#1e3a8a">Hi,</p>
<p>This is a reminder that you have a service scheduled for tomorrow:</p>

<div style="background:#fef3c7;border-left:4px solid #f59e0b;padding:12px;margin:20px 0">
<p style="margin:0;font-size:14px;font-weight:bold;color:#92400e">⏰ Service scheduled in 24 hours</p>
</div>

<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Service Details</h3>
<div style="border-top:1px solid #1e3a8a;margin-bottom:12px"></div>
<p>
<strong>Date:</strong> ${formatDateInTimezone(appointment.scheduled_date, userTimezone)}<br>
<strong>Time:</strong> ${formatTime(appointment.scheduled_time)}${appointment.end_time ? ` - ${formatTime(appointment.end_time)}` : ''}<br>
<strong>Service Type:</strong> ${appointment.service_type || 'N/A'}<br>
<strong>Cleaning Type:</strong> ${appointment.cleaning_type || 'N/A'}
</p>

<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Client Information</h3>
<div style="border-top:1px solid #1e3a8a;margin-bottom:12px"></div>
<p>
<strong>Name:</strong> ${client.full_name}<br>
<strong>Phone:</strong> ${client.phone}<br>
<strong>Address:</strong> ${client.service_street}${client.service_apt ? `, ${client.service_apt}` : ''}, ${client.service_city}, ${client.service_state} ${client.service_zip}
</p>

<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Assigned Team</h3>
<div style="border-top:1px solid #1e3a8a;margin-bottom:12px"></div>
<p>${employeeNames || 'No employees assigned'}</p>

</div>

<div style="text-align:center;padding:15px;background:#1e3a8a;color:white">
  <p style="margin:0">© 2024 ${companyInfo.company_name || 'Your Company'}</p>
</div>

</div>
</body>
</html>`;
};

const generate24hClientEmail = (appointment: any, client: any, employees: any[], companyInfo: any, userTimezone: string): string => {
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
  <h1 style="margin:0;font-size:22px">${companyInfo.company_name || 'Thunder Pro'}</h1>
  <p style="margin:5px 0">Service Reminder</p>
</div>

<div style="padding:15px">

<p style="font-size:16px;color:#1e3a8a">Dear ${client.full_name},</p>
<p>This is a friendly reminder about your upcoming cleaning service scheduled for tomorrow.</p>

<div style="background:#fef3c7;border-left:4px solid #f59e0b;padding:12px;margin:20px 0">
<p style="margin:0;font-size:14px;font-weight:bold;color:#92400e">⏰ Your service is scheduled in 24 hours</p>
</div>

<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Service Details</h3>
<div style="border-top:1px solid #1e3a8a;margin-bottom:12px"></div>
<p>
<strong>Date:</strong> ${formatDateInTimezone(appointment.scheduled_date, userTimezone)}<br>
<strong>Time:</strong> ${formatTime(appointment.scheduled_time)}${appointment.end_time ? ` - ${formatTime(appointment.end_time)}` : ''}<br>
<strong>Service Type:</strong> ${appointment.service_type || 'N/A'}<br>
<strong>Address:</strong> ${client.service_street}${client.service_apt ? `, ${client.service_apt}` : ''}, ${client.service_city}, ${client.service_state} ${client.service_zip}
</p>

<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Your Team</h3>
<div style="border-top:1px solid #1e3a8a;margin-bottom:12px"></div>
<p>${employeeNames || 'Team will be assigned shortly'}</p>

<div style="background:#eff6ff;border-left:4px solid #3b82f6;padding:12px;margin:20px 0">
<p style="margin:0;font-size:13px;color:#1e40af">📞 If you need to reschedule or have any questions, please contact us at ${companyInfo.company_phone || 'our office'}.</p>
</div>

</div>

<div style="text-align:center;padding:15px;background:#1e3a8a;color:white">
  <p style="margin:0">© 2024 ${companyInfo.company_name || 'Your Company'}</p>
</div>

</div>
</body>
</html>`;
};

const generate24hEmployeeEmail = (appointment: any, client: any, companyInfo: any, userTimezone: string): string => {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:20px;font-family:Arial,sans-serif">
<div style="max-width:600px;margin:0 auto">

<div style="text-align:center;padding:15px;background:#1e3a8a;color:white">
  <h1 style="margin:0;font-size:22px">${companyInfo.company_name || 'Thunder Pro'}</h1>
  <p style="margin:5px 0">Service Reminder - Tomorrow</p>
</div>

<div style="padding:15px">

<p style="font-size:16px;color:#1e3a8a">Hello Team,</p>
<p>This is a reminder about your service assignment scheduled for tomorrow.</p>

<div style="background:#fef3c7;border-left:4px solid #f59e0b;padding:12px;margin:20px 0">
<p style="margin:0;font-size:14px;font-weight:bold;color:#92400e">⏰ Service scheduled in 24 hours</p>
</div>

<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Service Details</h3>
<div style="border-top:1px solid #1e3a8a;margin-bottom:12px"></div>
<p>
<strong>Date:</strong> ${formatDateInTimezone(appointment.scheduled_date, userTimezone)}<br>
<strong>Time:</strong> ${formatTime(appointment.scheduled_time)}${appointment.end_time ? ` - ${formatTime(appointment.end_time)}` : ''}<br>
<strong>Service Type:</strong> ${appointment.service_type || 'N/A'}<br>
<strong>Client:</strong> ${client.full_name}<br>
<strong>Address:</strong> ${client.service_street}${client.service_apt ? `, ${client.service_apt}` : ''}, ${client.service_city}, ${client.service_state} ${client.service_zip}
</p>

<div style="background:#eff6ff;border-left:4px solid #3b82f6;padding:12px;margin:20px 0;text-align:center">
<p style="margin:0 0 8px 0;font-size:14px;font-weight:bold;color:#1e40af">⏰ Clock In/Out System</p>
<p style="margin:0 0 8px 0;font-size:13px;color:#1e40af">Use your phone number to clock in and out for this service:</p>
<a href="${publicAppUrl}/employee/login" style="display:inline-block;background:#3b82f6;color:white;padding:10px 24px;text-decoration:none;border-radius:5px;font-weight:bold;margin-top:4px">Clock In/Out Here</a>
</div>

</div>

<div style="text-align:center;padding:15px;background:#1e3a8a;color:white">
  <p style="margin:0">© 2024 ${companyInfo.company_name || 'Your Company'}</p>
</div>

</div>
</body>
</html>`;
};

// 1-Hour Reminder Templates (Only Owner & Client)
const generate1hReminderEmail = (appointment: any, client: any, employees: any[], companyInfo: any, isOwner: boolean, userTimezone: string): string => {
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
  <h1 style="margin:0;font-size:22px">${companyInfo.company_name || 'Thunder Pro'}</h1>
  <p style="margin:5px 0">Team On The Way!</p>
</div>

<div style="padding:15px">

<p style="font-size:16px;color:#1e3a8a">${isOwner ? 'Hi,' : `Dear ${client.full_name},`}</p>

<div style="background:#dcfce7;border-left:4px solid #10b981;padding:12px;margin:20px 0">
<p style="margin:0;font-size:16px;font-weight:bold;color:#065f46">🚗 The team assigned to your service is on its way!</p>
</div>

<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Service Details</h3>
<div style="border-top:1px solid #1e3a8a;margin-bottom:12px"></div>
<p>
<strong>Scheduled Time:</strong> ${formatTime(appointment.scheduled_time)}<br>
<strong>Service Type:</strong> ${appointment.service_type || 'N/A'}<br>
<strong>Address:</strong> ${client.service_street}${client.service_apt ? `, ${client.service_apt}` : ''}, ${client.service_city}, ${client.service_state} ${client.service_zip}
</p>

<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Your Team</h3>
<div style="border-top:1px solid #1e3a8a;margin-bottom:12px"></div>
<p>${employeeNames || 'Team assigned'}</p>

${!isOwner ? `
<div style="background:#eff6ff;border-left:4px solid #3b82f6;padding:12px;margin:20px 0">
<p style="margin:0;font-size:13px;color:#1e40af">📞 If you have any last-minute questions, please call us at ${companyInfo.company_phone || 'our office'}.</p>
</div>` : ''}

</div>

<div style="text-align:center;padding:15px;background:#1e3a8a;color:white">
  <p style="margin:0">© 2024 ${companyInfo.company_name || 'Your Company'}</p>
</div>

</div>
</body>
</html>`;
};

// SMTP Email Sending
async function sendEmailViaSMTP(
  toEmail: string,
  subject: string,
  htmlContent: string
): Promise<void> {
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
      command: string,
      maskInLog: boolean = false
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
    await sendCommand(tlsConn, btoa(smtpUser), true);
    await sendCommand(tlsConn, btoa(smtpPass), true);
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

  } catch (error: any) {
    console.error('SMTP Error:', error.message);
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
    console.log('⏰ Starting appointment reminder check...');

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const now = new Date();
    console.log(`🕐 Current UTC time: ${now.toISOString()}`);

    // Get today's and tomorrow's appointments with user timezone
    const todayDate = now.toISOString().split('T')[0];
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const tomorrowDate = tomorrow.toISOString().split('T')[0];

    const { data: appointments, error } = await supabaseClient
      .from('route_appointments')
      .select('*, clients(*)')
      .in('scheduled_date', [todayDate, tomorrowDate])
      .eq('status', 'scheduled');

    if (error) {
      console.error('Error fetching appointments:', error);
      throw error;
    }

    console.log(`📋 Found ${appointments?.length || 0} scheduled appointments`);

    if (!appointments || appointments.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: 'No appointments to remind', sent: 0 }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        }
      );
    }

    let sent24h = 0;
    let sent1h = 0;

    // Process each appointment
    for (const appointment of appointments) {
      try {
        console.log(`\n📋 Processing appointment ${appointment.id}`);

        const client = appointment.clients;
        if (!client) {
          console.log(`⚠️ No client info for appointment ${appointment.id}`);
          continue;
        }

        // Get user's timezone from profiles table
        const { data: profileData } = await supabaseClient
          .from('profiles')
          .select('timezone')
          .eq('user_id', appointment.user_id)
          .maybeSingle();

        const userTimezone = profileData?.timezone || 'America/New_York';
        console.log(`🌍 User timezone: ${userTimezone}`);

        // Parse scheduled time from scheduled_datetime (UTC timestamp)
        let scheduledDateTimeUTC: Date;

        if (appointment.scheduled_datetime) {
          // If we have scheduled_datetime (UTC), use it directly
          scheduledDateTimeUTC = new Date(appointment.scheduled_datetime);
        } else {
          // Fallback: construct from scheduled_date and scheduled_time
          const [hours, minutes] = (appointment.scheduled_time || '00:00').split(':').map(Number);
          const scheduledDateStr = `${appointment.scheduled_date}T${appointment.scheduled_time || '00:00'}:00`;
          const scheduledDateInUserTz = new Date(scheduledDateStr);
          scheduledDateTimeUTC = fromZonedTime(scheduledDateInUserTz, userTimezone);
        }

        console.log(`📅 Scheduled time in UTC: ${scheduledDateTimeUTC.toISOString()}`);

        // Calculate 24 hours before and 1 hour before in UTC
        const twentyFourHoursBefore = new Date(scheduledDateTimeUTC.getTime() - 24 * 60 * 60 * 1000);
        const oneHourBefore = new Date(scheduledDateTimeUTC.getTime() - 60 * 60 * 1000);

        console.log(`⏰ 24h before (UTC): ${twentyFourHoursBefore.toISOString()}`);
        console.log(`⏰ 1h before (UTC): ${oneHourBefore.toISOString()}`);

        // Check if we should send 24h reminder (within 5-minute window)
        const timeDiff24h = now.getTime() - twentyFourHoursBefore.getTime();
        const within24hWindow = timeDiff24h >= -5 * 60 * 1000 && timeDiff24h <= 5 * 60 * 1000;

        console.log(`⏱️ 24h diff: ${Math.round(timeDiff24h / 1000 / 60)} minutes, Within window: ${within24hWindow}`);

        if (within24hWindow) {
          // Check if 24h reminder already sent
          const { data: alreadySent24h } = await supabaseClient
            .from('appointment_reminders_sent')
            .select('id')
            .eq('appointment_id', appointment.id)
            .eq('reminder_type', '24h')
            .maybeSingle();

          if (!alreadySent24h) {

            // Get company info
            const { data: companyInfo } = await supabaseClient
              .from('profiles')
              .select('company_name, company_email, company_phone, timezone')
              .eq('user_id', appointment.user_id)
              .maybeSingle();

            const userTimezone = companyInfo?.timezone || 'America/New_York';

            // Get employees
            const employeeIds = Array.isArray(appointment.assigned_employees) ? appointment.assigned_employees : [];
            let employees: any[] = [];
            if (employeeIds.length > 0) {
              const { data: employeeData } = await supabaseClient
                .from('employees')
                .select('id, first_name, last_name, email')
                .in('id', employeeIds);
              employees = employeeData || [];
            }

            console.log(`📧 Sending 24h reminders for appointment ${appointment.id}`);

            // Send to owner
            if (companyInfo?.company_email) {
              await sendEmailViaSMTP(
                companyInfo.company_email,
                '24-Hour Reminder - Service Tomorrow',
                generate24hOwnerEmail(appointment, client, employees, companyInfo, userTimezone)
              );
            }

            // Send to client
            if (client.email) {
              await sendEmailViaSMTP(
                client.email,
                'Reminder: Your Service is Tomorrow',
                generate24hClientEmail(appointment, client, employees, companyInfo || {}, userTimezone)
              );
            }

            // Send to employees
            for (const employee of employees) {
              if (employee.email) {
                await sendEmailViaSMTP(
                  employee.email,
                  'Service Reminder - Tomorrow',
                  generate24hEmployeeEmail(appointment, client, companyInfo || {}, userTimezone)
                );
              }
            }

            // Mark as sent
            await supabaseClient
              .from('appointment_reminders_sent')
              .insert({
                appointment_id: appointment.id,
                reminder_type: '24h',
                sent_at: now.toISOString()
              });

            sent24h++;
            console.log(`✅ 24h reminders sent for appointment ${appointment.id}`);
          } else {
            console.log(`⏭️ 24h reminder already sent for appointment ${appointment.id}`);
          }
        }

        // Check if we should send 1h reminder (within 5-minute window)
        const timeDiff1h = now.getTime() - oneHourBefore.getTime();
        const within1hWindow = timeDiff1h >= -5 * 60 * 1000 && timeDiff1h <= 5 * 60 * 1000;

        console.log(`⏱️ 1h diff: ${Math.round(timeDiff1h / 1000 / 60)} minutes, Within window: ${within1hWindow}`);

        if (within1hWindow) {
          // Check if 1h reminder already sent
          const { data: alreadySent1h } = await supabaseClient
            .from('appointment_reminders_sent')
            .select('id')
            .eq('appointment_id', appointment.id)
            .eq('reminder_type', '1h')
            .maybeSingle();

          if (!alreadySent1h) {
            // Get company info (already fetched above, but keep for clarity)
            const { data: companyInfo } = await supabaseClient
              .from('profiles')
              .select('company_name, company_email, company_phone, timezone')
              .eq('user_id', appointment.user_id)
              .maybeSingle();

            const userTimezone = companyInfo?.timezone || 'America/New_York';

            // Get employees
            const employeeIds = Array.isArray(appointment.assigned_employees) ? appointment.assigned_employees : [];
            let employees: any[] = [];
            if (employeeIds.length > 0) {
              const { data: employeeData } = await supabaseClient
                .from('employees')
                .select('id, first_name, last_name, email')
                .in('id', employeeIds);
              employees = employeeData || [];
            }

            console.log(`📧 Sending 1h reminders for appointment ${appointment.id}`);

            // Send to owner
            if (companyInfo?.company_email) {
              await sendEmailViaSMTP(
                companyInfo.company_email,
                'Service Starting Soon - 1 Hour',
                generate1hReminderEmail(appointment, client, employees, companyInfo, true, userTimezone)
              );
            }

            // Send to client
            if (client.email) {
              await sendEmailViaSMTP(
                client.email,
                'We\'re On Our Way!',
                generate1hReminderEmail(appointment, client, employees, companyInfo || {}, false, userTimezone)
              );
            }

            // Mark as sent
            await supabaseClient
              .from('appointment_reminders_sent')
              .insert({
                appointment_id: appointment.id,
                reminder_type: '1h',
                sent_at: now.toISOString()
              });

            sent1h++;
            console.log(`✅ 1h reminders sent for appointment ${appointment.id}`);
          } else {
            console.log(`⏭️ 1h reminder already sent for appointment ${appointment.id}`);
          }
        }

      } catch (error) {
        console.error(`❌ Error processing appointment ${appointment.id}:`, error);
        // Continue with next appointment
      }
    }

    console.log(`✅ Sent ${sent24h} 24-hour reminders and ${sent1h} 1-hour reminders`);

    return new Response(
      JSON.stringify({
        success: true,
        sent24h,
        sent1h,
        message: `Sent ${sent24h} 24-hour reminders and ${sent1h} 1-hour reminders`
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  } catch (error: any) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

serve(handler);
