import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.76.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Helper function to format date in user's timezone
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

// scheduled_time and end_time are already in the user's local time (what they selected).
// Format directly without timezone conversion to avoid 5-hour offset errors.
const formatTime = (timeStr: string) => {
  if (!timeStr) return 'Not specified';
  const parts = String(timeStr).split(/[.:]/);
  const hour = parseInt(parts[0], 10);
  const minutes = parts[1] ? parseInt(parts[1], 10) : 0;
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${minutes.toString().padStart(2, '0')} ${ampm}`;
};

// Owner Email Template
const generateOwnerEmailTemplate = (appointment: any, client: any, employees: any[], companyInfo: any, userTimezone: string): string => {
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
  <h1 style="margin:10px 0 0 0;font-size:22px">${companyInfo.company_name || 'Thunder Pro'}</h1>
  <p style="margin:5px 0">New Service Appointment Created</p>
</div>
<div style="padding:15px">
<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Service Details</h3>
<div style="border-top:1px solid #1e3a8a;margin-bottom:12px"></div>
<p>
<strong>Service Type:</strong> ${appointment.service_type || 'N/A'}<br>
<strong>Cleaning Type:</strong> ${appointment.cleaning_type || 'N/A'}<br>
<strong>Date:</strong> ${formatDateInTimezone(appointment.scheduled_date, userTimezone)}<br>
<strong>Time:</strong> ${formatTime(appointment.scheduled_time)}${appointment.end_time ? ` - ${formatTime(appointment.end_time)}` : ''}<br>
${appointment.recurring_frequency ? `<strong>Recurring:</strong> ${appointment.recurring_frequency}<br>` : ''}
</p>
<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Client Information</h3>
<div style="border-top:1px solid #1e3a8a;margin-bottom:12px"></div>
<p>
<strong>Name:</strong> ${client.full_name}<br>
${client.company ? `<strong>Company:</strong> ${client.company}<br>` : ''}
<strong>Email:</strong> ${client.email}<br>
<strong>Phone:</strong> ${client.phone}<br>
<strong>Address:</strong> ${client.service_street}${client.service_apt ? `, ${client.service_apt}` : ''}, ${client.service_city}, ${client.service_state} ${client.service_zip}
</p>
<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Assigned Employees</h3>
<div style="border-top:1px solid #1e3a8a;margin-bottom:12px"></div>
<p>${employeeNames || 'No employees assigned'}</p>
${appointment.deposit_required === 'yes' && appointment.deposit_amount ? `
<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Payment Details</h3>
<div style="border-top:1px solid #1e3a8a;margin-bottom:12px"></div>
<p>
<strong>Deposit Required:</strong> Yes<br>
<strong>Deposit Amount:</strong> $${parseFloat(appointment.deposit_amount).toFixed(2)}<br>
<strong>Delivery Method:</strong> ${appointment.delivery_method || 'N/A'}
</p>` : ''}
${appointment.notes ? `
<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Notes</h3>
<div style="border-top:1px solid #1e3a8a;margin-bottom:12px"></div>
<p>${appointment.notes}</p>` : ''}
</div>
<div style="text-align:center;padding:15px;background:#1e3a8a;color:white">
  <p style="margin:0 0 5px 0;font-size:12px">Service provided by</p>
  <p style="margin:0">© 2024 Thunder Pro Inc. | <a href="https://www.thunderpro.co" style="color:white">www.thunderpro.co</a></p>
</div>
</div>
</body>
</html>`;
};

// Client Email Template
const generateClientEmailTemplate = (appointment: any, client: any, employees: any[], companyInfo: any, userTimezone: string): string => {
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
  <p style="margin:5px 0">Service Appointment Confirmation</p>
</div>
<div style="padding:15px">
<p style="font-size:16px;color:#1e3a8a">Dear ${client.full_name},</p>
<p>Thank you for scheduling a service with us. Your appointment has been confirmed with the following details:</p>
<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Service Details</h3>
<div style="border-top:1px solid #1e3a8a;margin-bottom:12px"></div>
<p>
<strong>Service Type:</strong> ${appointment.service_type || 'N/A'}<br>
<strong>Cleaning Type:</strong> ${appointment.cleaning_type || 'N/A'}<br>
<strong>Date:</strong> ${formatDateInTimezone(appointment.scheduled_date, userTimezone)}<br>
<strong>Time:</strong> ${formatTime(appointment.scheduled_time)}${appointment.end_time ? ` - ${formatTime(appointment.end_time)}` : ''}<br>
${appointment.recurring_frequency ? `<strong>Recurring:</strong> ${appointment.recurring_frequency}<br>` : ''}
</p>
<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Service Address</h3>
<div style="border-top:1px solid #1e3a8a;margin-bottom:12px"></div>
<p>${client.service_street}${client.service_apt ? `, ${client.service_apt}` : ''}<br>${client.service_city}, ${client.service_state} ${client.service_zip}</p>
<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Assigned Team</h3>
<div style="border-top:1px solid #1e3a8a;margin-bottom:12px"></div>
<p>${employeeNames || 'Team will be assigned shortly'}</p>
${appointment.deposit_required === 'yes' && appointment.deposit_amount ? `
<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Payment Details</h3>
<div style="border-top:1px solid #1e3a8a;margin-bottom:12px"></div>
<p>
<strong>Deposit Required:</strong> $${parseFloat(appointment.deposit_amount).toFixed(2)}<br>
<strong>Payment Method:</strong> ${appointment.delivery_method || 'N/A'}
</p>` : ''}
<div style="background:#eff6ff;border-left:4px solid #3b82f6;padding:12px;margin:20px 0">
<p style="margin:0;font-size:13px;color:#1e40af">📞 If you have any questions or need to reschedule, please contact us at ${companyInfo.company_phone || 'our office'}.</p>
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

// Employee Email Template
const generateEmployeeEmailTemplate = (appointment: any, client: any, companyInfo: any, userTimezone: string): string => {
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
  <p style="margin:5px 0">New Service Assignment</p>
</div>
<div style="padding:15px">
<p style="font-size:16px;color:#1e3a8a">Hello Team,</p>
<p>You have been assigned to a new service appointment with the following details:</p>
<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Service Details</h3>
<div style="border-top:1px solid #1e3a8a;margin-bottom:12px"></div>
<p>
<strong>Service Type:</strong> ${appointment.service_type || 'N/A'}<br>
<strong>Cleaning Type:</strong> ${appointment.cleaning_type || 'N/A'}<br>
<strong>Date:</strong> ${formatDateInTimezone(appointment.scheduled_date, userTimezone)}<br>
<strong>Time:</strong> ${formatTime(appointment.scheduled_time)}${appointment.end_time ? ` - ${formatTime(appointment.end_time)}` : ''}<br>
${appointment.recurring_frequency ? `<strong>Recurring:</strong> ${appointment.recurring_frequency}<br>` : ''}
</p>
<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Client Information</h3>
<div style="border-top:1px solid #1e3a8a;margin-bottom:12px"></div>
<p>
<strong>Name:</strong> ${client.full_name}<br>
<strong>Address:</strong> ${client.service_street}${client.service_apt ? `, ${client.service_apt}` : ''}, ${client.service_city}, ${client.service_state} ${client.service_zip}
</p>
${appointment.notes ? `
<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Service Notes</h3>
<div style="border-top:1px solid #1e3a8a;margin-bottom:12px"></div>
<p>${appointment.notes}</p>` : ''}
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
    try {
      if (tlsConn) tlsConn.close();
      if (conn) conn.close();
    } catch (closeError) {
      // Ignore close errors
    }
    throw new Error(`Failed to send email via SMTP: ${error.message}`);
  }
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('📧 Starting scheduled appointment email check...');

    // Use service role key for cron job (no auth required)
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Get today's date in YYYY-MM-DD format
    const today = new Date();
    const todayDate = today.toISOString().split('T')[0];

    console.log(`📅 Checking appointments for date: ${todayDate}`);

    // Fetch RECURRING appointments scheduled for today that haven't had emails sent yet
    // One-time appointments send emails immediately when created, so we only process recurring ones here
    const { data: appointments, error } = await supabaseClient
      .from('route_appointments')
      .select('*, clients(*)')
      .eq('scheduled_date', todayDate)
      .eq('status', 'scheduled')
      .eq('email_sent', false)
      .not('recurring_frequency', 'is', null); // Only recurring appointments (recurring_frequency is not null)

    if (error) {
      console.error('Error fetching appointments:', error);
      throw error;
    }

    console.log(`📋 Found ${appointments?.length || 0} appointments needing emails`);

    if (!appointments || appointments.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: 'No appointments to email', sent: 0 }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        }
      );
    }

    let sentCount = 0;
    let errorCount = 0;

    // Process each appointment
    for (const appointment of appointments) {
      try {
        console.log(`\n📋 Processing appointment ${appointment.id}`);

        const client = appointment.clients;
        if (!client) {
          console.log(`⚠️ No client info for appointment ${appointment.id}`);
          continue;
        }

        // Get user's profile for company info and timezone
        const { data: companyInfo } = await supabaseClient
          .from('profiles')
          .select('company_name, company_email, company_phone, timezone')
          .eq('user_id', appointment.user_id)
          .maybeSingle();

        const userTimezone = companyInfo?.timezone || 'America/New_York';

        // Fetch assigned employees
        const employeeIds = Array.isArray(appointment.assigned_employees)
          ? appointment.assigned_employees
          : [];

        let employees: any[] = [];
        if (employeeIds.length > 0) {
          const { data: employeeData } = await supabaseClient
            .from('employees')
            .select('id, first_name, last_name, email')
            .in('id', employeeIds);
          employees = employeeData || [];
        }

        // Generate email templates
        const ownerEmail = generateOwnerEmailTemplate(appointment, client, employees, companyInfo || {}, userTimezone);
        const clientEmail = generateClientEmailTemplate(appointment, client, employees, companyInfo || {}, userTimezone);
        const employeeEmail = generateEmployeeEmailTemplate(appointment, client, companyInfo || {}, userTimezone);

        // Send emails
        const emailPromises = [];

        // 1. Send to Owner/User
        if (companyInfo?.company_email) {
          emailPromises.push(
            sendEmailViaSMTP(
              companyInfo.company_email,
              `New Service Appointment - ${client.full_name}`,
              ownerEmail
            )
          );
        }

        // 2. Send to Client
        if (client.email) {
          emailPromises.push(
            sendEmailViaSMTP(
              client.email,
              `Service Appointment Confirmation - ${formatDateInTimezone(appointment.scheduled_date, userTimezone)}`,
              clientEmail
            )
          );
        }

        // 3. Send to Employees
        for (const employee of employees) {
          if (employee.email) {
            emailPromises.push(
              sendEmailViaSMTP(
                employee.email,
                `New Service Assignment - ${formatDateInTimezone(appointment.scheduled_date, userTimezone)}`,
                employeeEmail
              )
            );
          }
        }

        // Wait for all emails to send
        await Promise.all(emailPromises);

        // Mark email as sent to prevent duplicates
        const { error: updateError } = await supabaseClient
          .from('route_appointments')
          .update({ email_sent: true })
          .eq('id', appointment.id);

        if (updateError) {
          console.error(`⚠️ Failed to mark email as sent for appointment ${appointment.id}:`, updateError);
        } else {
          console.log(`✅ Emails sent and marked for appointment ${appointment.id}`);
          sentCount++;
        }

      } catch (appointmentError: any) {
        console.error(`❌ Error processing appointment ${appointment.id}:`, appointmentError);
        errorCount++;
        // Continue processing other appointments
      }
    }

    console.log(`\n✅ Email processing complete. Sent: ${sentCount}, Errors: ${errorCount}`);

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Scheduled emails processed',
        sent: sentCount,
        errors: errorCount,
        total: appointments.length
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
      }
    );
  } catch (error: any) {
    console.error('Error in send-scheduled-appointment-emails function:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
};

serve(handler);
