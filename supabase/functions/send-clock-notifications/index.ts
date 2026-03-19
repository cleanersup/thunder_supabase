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

// Format ISO timestamp in user's timezone (avoids 5-hour offset)
const formatTimeInTimezone = (isoStr: string | Date | null, timezone: string): string => {
  if (!isoStr) return 'N/A';
  try {
    const date = typeof isoStr === 'string' ? new Date(isoStr) : isoStr;
    return new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    }).format(date);
  } catch {
    return 'N/A';
  }
};

// Helper to format hours from decimal to "Xh Ymin"
const formatHours = (decimalHours: number) => {
  const hours = Math.floor(decimalHours);
  const minutes = Math.round((decimalHours - hours) * 60);
  return `${hours}h ${minutes.toString().padStart(2, '0')}min`;
};

// Clock In Email Template
const generateClockInEmail = (appointment: any, client: any, employees: any[], companyInfo: any, isOwner: boolean, timeEntry: any, userTimezone: string): string => {
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
  <p style="margin:5px 0">Service Started</p>
</div>

<div style="padding:15px">

<p style="font-size:16px;color:#1e3a8a">${isOwner ? 'Hi,' : `Dear ${client.full_name},`}</p>

<div style="background:#dcfce7;border-left:4px solid #10b981;padding:12px;margin:20px 0">
<p style="margin:0;font-size:16px;font-weight:bold;color:#065f46">✅ The team has started the service!</p>
</div>

<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Service Details</h3>
<div style="border-top:1px solid #1e3a8a;margin-bottom:12px"></div>
<p>
<strong>Started At:</strong> ${formatTimeInTimezone(timeEntry.clock_in_time, userTimezone)}<br>
<strong>Service Type:</strong> ${appointment.service_type || 'N/A'}<br>
<strong>Address:</strong> ${client.service_street}${client.service_apt ? `, ${client.service_apt}` : ''}, ${client.service_city}, ${client.service_state} ${client.service_zip}
</p>

<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Team Working</h3>
<div style="border-top:1px solid #1e3a8a;margin-bottom:12px"></div>
<p>${employeeNames}</p>

${!isOwner ? `
<div style="background:#eff6ff;border-left:4px solid #3b82f6;padding:12px;margin:20px 0">
<p style="margin:0;font-size:13px;color:#1e40af">📞 If you have any questions during the service, please contact us at ${companyInfo.company_phone || 'our office'}.</p>
</div>` : ''}

</div>

<div style="text-align:center;padding:15px;background:#1e3a8a;color:white">
  <p style="margin:0">© 2024 ${companyInfo.company_name || 'Your Company'}</p>
</div>

</div>
</body>
</html>`;
};

// Clock Out Email Template
const generateClockOutEmail = (appointment: any, client: any, employees: any[], companyInfo: any, isOwner: boolean, timeEntry: any, userTimezone: string): string => {
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
  <p style="margin:5px 0">Service Completed</p>
</div>

<div style="padding:15px">

<p style="font-size:16px;color:#1e3a8a">${isOwner ? 'Hi,' : `Dear ${client.full_name},`}</p>

<div style="background:#dcfce7;border-left:4px solid #10b981;padding:12px;margin:20px 0">
<p style="margin:0;font-size:16px;font-weight:bold;color:#065f46">🎉 Service completed successfully!</p>
</div>

<p>The cleaning service has been completed. We hope you're satisfied with the results!</p>

<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Service Summary</h3>
<div style="border-top:1px solid #1e3a8a;margin-bottom:12px"></div>
<p>
<strong>Completed At:</strong> ${formatTimeInTimezone(timeEntry.clock_out_time, userTimezone)}<br>
<strong>Service Type:</strong> ${appointment.service_type || 'N/A'}<br>
<strong>Team:</strong> ${employeeNames}<br>
<strong>Address:</strong> ${client.service_street}${client.service_apt ? `, ${client.service_apt}` : ''}, ${client.service_city}, ${client.service_state} ${client.service_zip}
</p>

${!isOwner ? `
<div style="background:#fef3c7;border-left:4px solid #f59e0b;padding:12px;margin:20px 0">
<p style="margin:0;font-size:14px;font-weight:bold;color:#92400e">⭐ We'd love your feedback!</p>
<p style="margin:8px 0 0 0;font-size:13px;color:#92400e">How was your experience? Your feedback helps us improve our service.</p>
</div>

<div style="background:#eff6ff;border-left:4px solid #3b82f6;padding:12px;margin:20px 0">
<p style="margin:0;font-size:13px;color:#1e40af">Thank you for choosing ${companyInfo.company_name || 'Thunder Pro'}! We look forward to serving you again.</p>
</div>` : ''}

</div>

<div style="text-align:center;padding:15px;background:#1e3a8a;color:white">
  <p style="margin:0">© 2024 ${companyInfo.company_name || 'Your Company'}</p>
</div>

</div>
</body>
</html>`;
};

// Simple Clock In Email for Owner (when no appointment assigned)
const generateSimpleClockInEmail = (employee: any, timeEntry: any, companyInfo: any, userTimezone: string): string => {
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
  <p style="margin:5px 0">Employee Clock In</p>
</div>

<div style="padding:15px">

<div style="background:#fef3c7;border-left:4px solid #f59e0b;padding:12px;margin:20px 0">
<p style="margin:0;font-size:16px;font-weight:bold;color:#92400e">⚠️ Clock In Without Service Assignment</p>
</div>

<p>The following employee has clocked in but no service was assigned for today:</p>

<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Employee Information</h3>
<div style="border-top:1px solid #1e3a8a;margin-bottom:12px"></div>
<p>
<strong>Name:</strong> ${employee.first_name} ${employee.last_name}<br>
<strong>Clock In Time:</strong> ${formatTimeInTimezone(timeEntry.clock_in_time, userTimezone)}<br>
<strong>Date:</strong> ${timeEntry.date}
</p>

<div style="background:#eff6ff;border-left:4px solid #3b82f6;padding:12px;margin:20px 0">
<p style="margin:0;font-size:13px;color:#1e40af">💡 This employee clocked in without a scheduled service. You may want to verify their assignment.</p>
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

// Simple Clock Out Email for Owner (when no appointment assigned)
const generateSimpleClockOutEmail = (employee: any, timeEntry: any, companyInfo: any, userTimezone: string): string => {
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
  <p style="margin:5px 0">Employee Clock Out</p>
</div>

<div style="padding:15px">

<div style="background:#dcfce7;border-left:4px solid #10b981;padding:12px;margin:20px 0">
<p style="margin:0;font-size:16px;font-weight:bold;color:#065f46">✅ Employee has clocked out</p>
</div>

<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Employee Information</h3>
<div style="border-top:1px solid #1e3a8a;margin-bottom:12px"></div>
<p>
<strong>Name:</strong> ${employee.first_name} ${employee.last_name}<br>
<strong>Clock Out Time:</strong> ${formatTimeInTimezone(timeEntry.clock_out_time, userTimezone)}<br>
<strong>Date:</strong> ${timeEntry.date}<br>
${timeEntry.total_hours ? `<strong>Total Hours:</strong> ${formatHours(timeEntry.total_hours)}<br>` : ''}
</p>

<div style="background:#eff6ff;border-left:4px solid #3b82f6;padding:12px;margin:20px 0">
<p style="margin:0;font-size:13px;color:#1e40af">💡 This time entry was not associated with a specific service.</p>
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
    } catch { }
    throw error;
  }
}

const handler = async (req: Request): Promise<Response> => {
  return await Sentry.withScope(async (scope) => {
    Sentry.setTag("function", "send-clock-notifications");

    if (req.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      const { timeEntryId, eventType } = await req.json();
      Sentry.setTag("event_type", eventType);
      Sentry.addBreadcrumb({ message: `Processing ${eventType} notification`, level: "info" });

      if (!timeEntryId || !eventType) {
        throw new Error('Missing required fields: timeEntryId and eventType');
      }

      console.log(`Processing ${eventType} notification for time entry:`, timeEntryId);

      const supabaseClient = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
      );

      // Get time entry first
      const { data: timeEntry, error: timeEntryError } = await supabaseClient
        .from('time_entries')
        .select('*')
        .eq('id', timeEntryId)
        .maybeSingle();

      if (timeEntryError || !timeEntry) {
        throw new Error('Time entry not found');
      }

      // Get the employee who clocked in/out
      const { data: employee } = await supabaseClient
        .from('employees')
        .select('id, first_name, last_name, email')
        .eq('id', timeEntry.employee_id)
        .maybeSingle();

      // Get company info
      const { data: companyInfo } = await supabaseClient
        .from('profiles')
        .select('company_name, company_email, company_phone, timezone')
        .eq('user_id', timeEntry.user_id)
        .maybeSingle();

      const userTimezone = companyInfo?.timezone || 'America/New_York';

      // Check if there's an appointment associated
      let appointment = null;
      let client = null;
      let employees: any[] = [];

      if (timeEntry.route_appointment_id) {
        // Get appointment with client info
        const { data: appointmentData } = await supabaseClient
          .from('route_appointments')
          .select('*, clients(*)')
          .eq('id', timeEntry.route_appointment_id)
          .maybeSingle();

        if (appointmentData) {
          appointment = appointmentData;
          client = appointmentData.clients;

          // Get all assigned employees for this appointment
          const employeeIds = Array.isArray(appointment.assigned_employees) ? appointment.assigned_employees : [];
          if (employeeIds.length > 0) {
            const { data: employeeData } = await supabaseClient
              .from('employees')
              .select('id, first_name, last_name, email')
              .in('id', employeeIds);
            employees = employeeData || [];
          }
        }
      }

      // Check if this notification was already sent (only if there's an appointment)
      if (appointment) {
        const { data: alreadySent } = await supabaseClient
          .from('appointment_reminders_sent')
          .select('id')
          .eq('appointment_id', appointment.id)
          .eq('reminder_type', eventType)
          .maybeSingle();

        if (alreadySent) {
          console.log(`⏭️ ${eventType} notification already sent for appointment ${appointment.id}`);
          return new Response(
            JSON.stringify({
              success: true,
              message: `${eventType} notification already sent`
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json", ...corsHeaders },
            }
          );
        }
      }

      const emailPromises = [];

      if (appointment && client) {
        // SCENARIO 1: Employee clocked in/out WITH an assigned service
        console.log('📧 Sending emails to owner AND client (service assigned)');

        if (eventType === 'clock_in') {
          // Send to owner
          if (companyInfo?.company_email) {
            emailPromises.push(
              sendEmailViaSMTP(
                companyInfo.company_email,
                'Service Started',
                generateClockInEmail(appointment, client, employees, companyInfo, true, timeEntry, userTimezone)
              )
            );
          }

          // Send to client
          if (client.email) {
            emailPromises.push(
              sendEmailViaSMTP(
                client.email,
                'Your Service Has Started',
                generateClockInEmail(appointment, client, employees, companyInfo || {}, false, timeEntry, userTimezone)
              )
            );
          }
        } else if (eventType === 'clock_out') {
          // Send to owner
          if (companyInfo?.company_email) {
            emailPromises.push(
              sendEmailViaSMTP(
                companyInfo.company_email,
                'Service Completed',
                generateClockOutEmail(appointment, client, employees, companyInfo, true, timeEntry, userTimezone)
              )
            );
          }

          // Send to client
          if (client.email) {
            emailPromises.push(
              sendEmailViaSMTP(
                client.email,
                'Service Completed - Thank You!',
                generateClockOutEmail(appointment, client, employees, companyInfo || {}, false, timeEntry, userTimezone)
              )
            );
          }
        }

        // Mark as sent for the appointment
        await supabaseClient
          .from('appointment_reminders_sent')
          .insert({
            appointment_id: appointment.id,
            reminder_type: eventType
          });

      } else {
        // SCENARIO 2: Employee clocked in/out WITHOUT an assigned service
        console.log('📧 Sending email ONLY to owner (no service assigned)');

        if (eventType === 'clock_in') {
          // Send simple notification to owner only
          if (companyInfo?.company_email && employee) {
            emailPromises.push(
              sendEmailViaSMTP(
                companyInfo.company_email,
                `Employee Clock In - ${employee.first_name} ${employee.last_name}`,
                generateSimpleClockInEmail(employee, timeEntry, companyInfo, userTimezone)
              )
            );
          }
        } else if (eventType === 'clock_out') {
          // Send simple notification to owner only
          if (companyInfo?.company_email && employee) {
            emailPromises.push(
              sendEmailViaSMTP(
                companyInfo.company_email,
                `Employee Clock Out - ${employee.first_name} ${employee.last_name}`,
                generateSimpleClockOutEmail(employee, timeEntry, companyInfo, userTimezone)
              )
            );
          }
        }
      }

      await Promise.all(emailPromises);

      console.log(`✅ ${eventType} notifications sent successfully`);

      return new Response(
        JSON.stringify({
          success: true,
          message: `${eventType} notifications sent successfully`
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        }
      );
    } catch (error: any) {
      Sentry.captureException(error);
      console.error('Error:', error);
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }
  });
};

serve(handler);
