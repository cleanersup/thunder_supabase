import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.76.1';
import * as Sentry from "npm:@sentry/deno";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Get app URL from environment variables
const publicAppUrl = Deno.env.get("PUBLIC_APP_URL") || Deno.env.get("APP_URL") || "https://app.staging.thunderpro.co";

Sentry.init({
  dsn: "https://ce035a76b6157a602d88c53eab6570e4@o4509804047958016.ingest.us.sentry.io/4510552540971008",
  environment: Deno.env.get("SUPABASE_URL")?.includes("staging") ? "staging" : "production",
  tracesSampleRate: 0.1,
});

interface AppointmentEmailRequest {
  appointmentId: string;
  isUpdate?: boolean;
}

// Helper function to format date in user's timezone
// FIX: scheduled_date is stored as DATE (YYYY-MM-DD) without timezone info
// Problem: new Date("2024-12-13") is interpreted as UTC midnight (2024-12-13T00:00:00Z)
// When formatted in timezone like "America/New_York" (UTC-5), it becomes 2024-12-12T19:00:00 (previous day)
// Solution: Parse date components and create date at midday in user's timezone to avoid day shift
const formatDateInTimezone = (dateStr: string, timezone: string) => {
  // Parse date string (YYYY-MM-DD format from database)
  const [year, month, day] = dateStr.split('-').map(Number);

  // Create date at midday (12:00) to avoid timezone edge cases
  // This ensures the date stays correct regardless of timezone offset
  const dateAtMidday = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));

  // Format in user's timezone - using midday ensures date is always correct
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: timezone
  }).format(dateAtMidday);
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

// Owner Email Template - Full information
const generateOwnerEmailTemplate = (appointment: any, client: any, employees: any[], companyInfo: any, userTimezone: string): string => {
  const employeeNames = employees.map(e => `${e.first_name} ${e.last_name}`).join(', ');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
@media only screen and (max-width: 600px) {
  .email-container {
    max-width: 100% !important;
  }
  .email-body {
    padding: 10px !important;
  }
  .email-content {
    padding: 10px !important;
  }
}
</style>
</head>
<body style="margin:0;padding:20px;font-family:Arial,sans-serif">
<div class="email-container" style="max-width:600px;margin:0 auto">

<div class="email-body" style="text-align:center;padding:15px;background:#1e3a8a;color:white">
  <p style="margin:0;font-size:14px;font-weight:bold;background:#1e40af;padding:8px;border-radius:4px">OWNER COPY - INTERNAL USE ONLY</p>
  <h1 style="margin:10px 0 0 0;font-size:22px">${companyInfo.company_name || 'Thunder Pro'}</h1>
  <p style="margin:5px 0">New Service Appointment Created</p>
</div>

<div class="email-content" style="padding:15px">

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

// Client Email Template - Full information
const generateClientEmailTemplate = (appointment: any, client: any, employees: any[], companyInfo: any, userTimezone: string, isUpdate?: boolean): string => {
  const employeeNames = employees.map(e => `${e.first_name} ${e.last_name}`).join(', ');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
@media only screen and (max-width: 600px) {
  .email-container {
    max-width: 100% !important;
  }
  .email-body {
    padding: 10px !important;
  }
  .email-content {
    padding: 10px !important;
  }
}
</style>
</head>
<body style="margin:0;padding:20px;font-family:Arial,sans-serif">
<div class="email-container" style="max-width:600px;margin:0 auto">

<div class="email-body" style="text-align:center;padding:15px;background:#1e3a8a;color:white">
  <h1 style="margin:0;font-size:22px">${companyInfo.company_name || 'Thunder Pro'}</h1>
  <p style="margin:5px 0">Service Appointment Confirmation</p>
</div>

<div class="email-content" style="padding:15px">

<p style="font-size:16px;color:#1e3a8a">Dear ${client.full_name},</p>
<p>${isUpdate ? 'Your service appointment has been updated with the following details:' : 'Thank you for scheduling a service with us. Your appointment has been confirmed with the following details:'}</p>

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

// Employee Email Template - Limited information (NO prices, deposits, client contact)
const generateEmployeeEmailTemplate = (appointment: any, client: any, companyInfo: any, userTimezone: string, isUpdate?: boolean): string => {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
@media only screen and (max-width: 600px) {
  .email-container {
    max-width: 100% !important;
  }
  .email-body {
    padding: 10px !important;
  }
  .email-content {
    padding: 10px !important;
  }
}
</style>
</head>
<body style="margin:0;padding:20px;font-family:Arial,sans-serif">
<div class="email-container" style="max-width:600px;margin:0 auto">

<div class="email-body" style="text-align:center;padding:15px;background:#1e3a8a;color:white">
  <h1 style="margin:0;font-size:22px">${companyInfo.company_name || 'Thunder Pro'}</h1>
  <p style="margin:5px 0">New Service Assignment</p>
</div>

<div class="email-content" style="padding:15px">

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

<div style="background:#eff6ff;border-left:4px solid #3b82f6;padding:12px;margin:20px 0;text-align:center">
<p style="margin:0 0 8px 0;font-size:14px;font-weight:bold;color:#1e40af">⏰ Clock In/Out System</p>
<p style="margin:0 0 8px 0;font-size:13px;color:#1e40af">Use your phone number to clock in and out for this service:</p>
<a href="${publicAppUrl}/employee/login" style="display:inline-block;background:#3b82f6;color:white;padding:10px 24px;text-decoration:none;border-radius:5px;font-weight:bold;margin-top:4px">Clock In/Out Here</a>
</div>

<div style="background:#eff6ff;border-left:4px solid #3b82f6;padding:12px;margin:20px 0">
<p style="margin:0;font-size:13px;color:#1e40af">📱 For any questions about this assignment, please contact your supervisor or office.</p>
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

// SMTP Email Sending Function
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
  const fromEmail = '"Thunder Pro" <info@thunderpro.co>';

  console.log('Sending email to:', toEmail, 'Subject:', subject);

  let conn: Deno.TcpConn | null = null;
  let tlsConn: Deno.TlsConn | null = null;

  try {
    conn = await Deno.connect({ hostname: smtpHost, port: smtpPort });
    console.log('✓ TCP connection established');

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
      const displayCommand = maskInLog ? command.substring(0, 15) + '...' : command;
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
    console.log('✓ TLS established');

    await sendCommand(tlsConn, 'EHLO thunderpro.co');
    await tlsConn.write(encoder.encode('AUTH LOGIN\r\n'));
    await readResponse(tlsConn);
    await sendCommand(tlsConn, btoa(smtpUser), true);
    await sendCommand(tlsConn, btoa(smtpPass), true);
    console.log('✓ Authentication successful');

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
    console.log('=== Email sent successfully to', toEmail, '===');

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

const handler = async (req: Request): Promise<Response> => {
  return await Sentry.withScope(async (scope) => {
    Sentry.setTag("function", "send-appointment-emails");

    if (req.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      const { appointmentId, isUpdate }: AppointmentEmailRequest = await req.json();

      console.log('Processing appointment email request:', { appointmentId, isUpdate });

      if (!appointmentId) {
        throw new Error('Missing required field: appointmentId');
      }

      // Get Authorization header to create authenticated Supabase client
      const authHeader = req.headers.get('Authorization');
      if (!authHeader) {
        throw new Error('No authorization header');
      }

      const token = authHeader.replace('Bearer ', '');
      const supabaseClient = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_ANON_KEY') ?? '',
        { global: { headers: { Authorization: authHeader } } }
      );

      // Get the authenticated user
      const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token);
      if (authError || !user?.id) {
        throw new Error('User not authenticated');
      }

      console.log('✓ User authenticated:', user.id);

      // Fetch appointment details
      const { data: appointment, error: appointmentError } = await supabaseClient
        .from('route_appointments')
        .select('*')
        .eq('id', appointmentId)
        .single();

      if (appointmentError || !appointment) {
        throw new Error('Appointment not found');
      }

      console.log('✓ Appointment loaded');

      // Fetch client details
      const { data: client, error: clientError } = await supabaseClient
        .from('clients')
        .select('*')
        .eq('id', appointment.client_id)
        .single();

      if (clientError || !client) {
        throw new Error('Client not found');
      }

      console.log('✓ Client loaded:', client.full_name);

      // Fetch company info (owner profile)
      const { data: companyInfo, error: companyError } = await supabaseClient
        .from('profiles')
        .select('company_name, company_email, company_phone, timezone')
        .eq('user_id', user.id)
        .single();

      if (companyError) {
        console.warn('Could not load company info:', companyError.message);
      }

      console.log('✓ Company info loaded');

      const userTimezone = companyInfo?.timezone || 'America/New_York';

      // Fetch assigned employees
      const employeeIds = Array.isArray(appointment.assigned_employees)
        ? appointment.assigned_employees
        : [];

      let employees: any[] = [];
      if (employeeIds.length > 0) {
        const { data: employeeData, error: employeeError } = await supabaseClient
          .from('employees')
          .select('id, first_name, last_name, email')
          .in('id', employeeIds);

        if (employeeError) {
          console.warn('Could not load employees:', employeeError.message);
        } else {
          employees = employeeData || [];
        }
      }

      console.log('✓ Employees loaded:', employees.length);

      // Generate email templates
      const ownerEmail = generateOwnerEmailTemplate(appointment, client, employees, companyInfo || {}, userTimezone, isUpdate);
      const clientEmail = generateClientEmailTemplate(appointment, client, employees, companyInfo || {}, userTimezone, isUpdate);
      const employeeEmail = generateEmployeeEmailTemplate(appointment, client, companyInfo || {}, userTimezone, isUpdate);

      // Determine email subjects based on whether this is an update
      const ownerSubject = isUpdate 
        ? `Service Appointment Updated - ${client.full_name}`
        : `New Service Appointment - ${client.full_name}`;
      const clientSubject = isUpdate
        ? `Service Appointment Updated - ${formatDateInTimezone(appointment.scheduled_date, userTimezone)}`
        : `Service Appointment Confirmation - ${formatDateInTimezone(appointment.scheduled_date, userTimezone)}`;
      const employeeSubject = isUpdate
        ? `Service Assignment Updated - ${formatDateInTimezone(appointment.scheduled_date, userTimezone)}`
        : `New Service Assignment - ${formatDateInTimezone(appointment.scheduled_date, userTimezone)}`;

      // Send emails
      const emailPromises = [];

      // 1. Send to Owner/User
      if (companyInfo?.company_email) {
        console.log('Sending email to owner:', companyInfo.company_email);
        emailPromises.push(
          sendEmailViaSMTP(
            companyInfo.company_email,
            ownerSubject,
            ownerEmail
          )
        );
      }

      // 2. Send to Client
      if (client.email) {
        console.log('Sending email to client:', client.email);
        emailPromises.push(
          sendEmailViaSMTP(
            client.email,
            clientSubject,
            clientEmail
          )
        );
      }

      // 3. Send to Employees
      for (const employee of employees) {
        if (employee.email) {
          console.log('Sending email to employee:', employee.email);
          emailPromises.push(
            sendEmailViaSMTP(
              employee.email,
              employeeSubject,
              employeeEmail
            )
          );
        }
      }

      // Wait for all emails to send
      await Promise.all(emailPromises);

      console.log('✅ All emails sent successfully');

      // Mark email as sent to prevent duplicates (if called manually)
      // Note: Scheduled emails are handled by send-scheduled-appointment-emails function
      try {
        const serviceRoleClient = createClient(
          Deno.env.get('SUPABASE_URL') ?? '',
          Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        );

        await serviceRoleClient
          .from('route_appointments')
          .update({ email_sent: true })
          .eq('id', appointmentId);

        console.log('✓ Email marked as sent in database');
      } catch (updateError) {
        console.warn('Could not mark email as sent:', updateError);
        // Don't fail the request if update fails
      }

      return new Response(
        JSON.stringify({
          success: true,
          message: 'All emails sent successfully',
          sentTo: {
            owner: companyInfo?.company_email || null,
            client: client.email || null,
            employees: employees.filter(e => e.email).map(e => e.email)
          }
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
      Sentry.captureException(error);
      console.error('Error in send-appointment-emails function:', error);
      return new Response(
        JSON.stringify({ error: error.message }),
        {
          status: 500,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        }
      );
    }
  });
};

serve(handler);
