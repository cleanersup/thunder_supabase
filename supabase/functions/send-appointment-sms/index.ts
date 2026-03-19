import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
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

interface AppointmentSMSRequest {
    appointmentId: string;
    isUpdate?: boolean;
}

// Normalize phone number: add +1 prefix if not present
const normalizePhoneNumber = (phone: string): string => {
    const cleaned = phone.replace(/[^\d+]/g, '');

    if (cleaned.startsWith('+1')) {
        return cleaned;
    }

    const digits = cleaned.startsWith('+') ? cleaned.slice(1) : cleaned;
    return `+1${digits}`;
};

// Format date in user's timezone
const formatDateInTimezone = (dateStr: string, timezone: string): string => {
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

// Format time
const formatTime = (timeStr: string): string => {
    if (!timeStr) return 'Not specified';
    const [hours, minutes] = timeStr.split(':');
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${minutes} ${ampm}`;
};

serve(async (req) => {
    return await Sentry.withScope(async (scope) => {
        Sentry.setTag("function", "send-appointment-sms");

        if (req.method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders });
        }

        console.log("=== send-appointment-sms FUNCTION TRIGGERED ===");
        console.log("Timestamp:", new Date().toISOString());

        try {
            const body = await req.json();
            const { appointmentId, isUpdate }: AppointmentSMSRequest = body;

            console.log("=== APPOINTMENT SMS REQUEST ===");
            console.log("Is Update:", isUpdate);

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
            const companyName = companyInfo?.company_name || 'Thunder Pro';
            const formattedDate = formatDateInTimezone(appointment.scheduled_date, userTimezone);

            // Get public app URL
            const publicAppUrl = Deno.env.get("PUBLIC_APP_URL") || Deno.env.get("APP_URL") || "https://app.staging.thunderpro.co";

            // Generate PDF URL for client and employee
            const pdfUrl = `${publicAppUrl}/functions/v1/download-appointment-pdf?id=${appointmentId}`;

            // Generate client info URL for employee (excluding email and phone)
            const clientInfoUrl = `${publicAppUrl}/appointment/${appointmentId}`;

            // Format client address
            const clientAddress = `${client.service_street}${client.service_apt ? `, ${client.service_apt}` : ''}, ${client.service_city}, ${client.service_state} ${client.service_zip}`;

            // Twilio credentials
            const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID');
            const authToken = Deno.env.get('TWILIO_AUTH_TOKEN');
            const twilioPhone = Deno.env.get('TWILIO_PHONE_NUMBER');

            if (!accountSid || !authToken || !twilioPhone) {
                throw new Error('Missing Twilio credentials');
            }

            const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;

            console.log("PDF URL", pdfUrl);

            // Send SMS to client
            if (client.phone) {
                const normalizedClientPhone = normalizePhoneNumber(client.phone);
                let clientMessage = `Update from ${companyName}: Your job scheduled for ${formattedDate} has been assigned and is on route for completion. See more details here: ${pdfUrl}`;
                
                // Update message when appointment is updated
                if (isUpdate) {
                    clientMessage = `Update from ${companyName}: Your job scheduled for ${formattedDate} has been updated. See more details here: ${pdfUrl}`;
                }

                console.log('=== PREPARING SMS MESSAGE ===');
                console.log('Is Update:', isUpdate);
                console.log('Message text that will be sent:', clientMessage);
                console.log('Sending SMS to client:', normalizedClientPhone);

                console.log("=== SENDING SMS VIA TWILIO ===");
                console.log("Final SMS message text (client):", clientMessage);
                console.log("Recipient phone:", normalizedClientPhone);
                console.log("From phone:", twilioPhone);

                const clientResponse = await fetch(twilioUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'Authorization': 'Basic ' + btoa(`${accountSid}:${authToken}`),
                    },
                    body: new URLSearchParams({
                        To: normalizedClientPhone,
                        From: twilioPhone,
                        Body: clientMessage,
                    }),
                });

                const clientData = await clientResponse.json();

                if (!clientResponse.ok) {
                    console.error('Failed to send SMS to client:', clientData.message || clientData.error_message);
                } else {
                    console.log('✓ SMS sent to client:', clientData.sid);
                }
            }

            // Fetch assigned employees
            const employeeIds = Array.isArray(appointment.assigned_employees)
                ? appointment.assigned_employees
                : [];

            let employees: any[] = [];
            if (employeeIds.length > 0) {
                const { data: employeeData, error: employeeError } = await supabaseClient
                    .from('employees')
                    .select('id, first_name, last_name, phone')
                    .in('id', employeeIds);

                if (employeeError) {
                    console.warn('Could not load employees:', employeeError.message);
                } else {
                    employees = employeeData || [];
                }
            }

            console.log('✓ Employees loaded:', employees.length);

            // Send SMS to each employee
            const employeePromises = employees.map(async (employee) => {
                if (!employee.phone) {
                    console.warn(`Skipping employee ${employee.first_name} ${employee.last_name} - no phone number`);
                    return;
                }

                const normalizedEmployeePhone = normalizePhoneNumber(employee.phone);

                // Format time range
                const timeRange = `${formatTime(appointment.scheduled_time)}${appointment.end_time ? ` to ${formatTime(appointment.end_time)}` : ''}`;

                // Format service info
                const serviceInfo = [
                    appointment.service_type,
                    appointment.cleaning_type ? `(${appointment.cleaning_type})` : null
                ].filter(Boolean).join(' ');

                // Employee login URL for clock in/out (dynamic based on environment)
                const employeeLoginUrl = `${publicAppUrl}/employee/login`;

                // Build structured message for employee
                let employeeMessage = isUpdate
                    ? `Job updated for ${formattedDate}!\n\n`
                    : `New job assigned for ${formattedDate}!\n\n`;

                employeeMessage += `Date/Time: ${formattedDate} – ${timeRange}\n\n`;
                employeeMessage += `Client: ${client.full_name}\n`;
                employeeMessage += `Address: ${clientAddress}\n`;
                employeeMessage += `Service: ${serviceInfo || 'N/A'}\n`;

                if (appointment.notes) {
                    employeeMessage += `Notes: ${appointment.notes}\n`;
                }

                employeeMessage += `\nClock in/out and view full details here: ${employeeLoginUrl}`;

                console.log('Sending SMS to employee:', normalizedEmployeePhone);
                console.log('Employee message text:', employeeMessage);

                const employeeResponse = await fetch(twilioUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'Authorization': 'Basic ' + btoa(`${accountSid}:${authToken}`),
                    },
                    body: new URLSearchParams({
                        To: normalizedEmployeePhone,
                        From: twilioPhone,
                        Body: employeeMessage,
                    }),
                });

                const employeeData = await employeeResponse.json();

                if (!employeeResponse.ok) {
                    console.error(`Failed to send SMS to employee ${employee.first_name} ${employee.last_name}:`, employeeData.message || employeeData.error_message);
                } else {
                    console.log(`✓ SMS sent to employee ${employee.first_name} ${employee.last_name}:`, employeeData.sid);
                }
            });

            await Promise.all(employeePromises);

            return new Response(
                JSON.stringify({
                    success: true,
                    message: 'SMS messages sent successfully',
                    sentTo: {
                        client: client.phone ? 'sent' : 'no phone',
                        employees: employees.filter(e => e.phone).length
                    }
                }),
                {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                    status: 200,
                }
            );
        } catch (error: any) {
            Sentry.captureException(error);
            console.error("Error in send-appointment-sms:", error);
            return new Response(
                JSON.stringify({ error: error?.message || 'Internal server error' }),
                {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                    status: 500,
                }
            );
        }
    });
});
