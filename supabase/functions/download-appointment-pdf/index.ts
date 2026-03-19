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

// Helper function to format date in user's timezone
const formatDateInTimezone = (dateStr: string, timezone: string) => {
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

// Helper function to format time
const formatTime = (timeStr: string) => {
    if (!timeStr) return 'Not specified';
    const [hours, minutes] = timeStr.split(':');
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${minutes} ${ampm}`;
};

// Helper to format currency
const formatCurrency = (value: number): string => {
    return value.toFixed(2);
};

// Generate PDF using jsPDF
// This function creates a PDF matching the client email design
async function generateAppointmentPDF(
    appointment: any,
    client: any,
    employees: any[],
    profile: any,
    userTimezone: string,
    appBaseUrl: string
): Promise<Uint8Array> {
    // Import jsPDF dynamically for Deno Edge Functions
    const jsPDF = (await import('https://esm.sh/jspdf@2.5.1')).default;

    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 20;
    let yPosition = 0;

    // Colors matching email design
    const darkBlue = [30, 58, 138]; // #1e3a8a
    const darkGrey = [51, 51, 51]; // #333333
    const lightGrey = [249, 250, 251]; // #f9fafb
    const borderGrey = [229, 231, 235]; // #e5e7eb

    // ===== HEADER (Dark Blue Banner) =====
    doc.setFillColor(darkBlue[0], darkBlue[1], darkBlue[2]);
    doc.rect(0, yPosition, pageWidth, 30, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(22);
    doc.setFont('helvetica', 'bold');
    const companyName = profile?.company_name || 'Thunder Pro';
    doc.text(companyName, pageWidth / 2, yPosition + 12, { align: 'center' });
    doc.setFontSize(14);
    doc.setFont('helvetica', 'normal');
    doc.text('Service Appointment Confirmation', pageWidth / 2, yPosition + 22, { align: 'center' });
    yPosition = 40;

    // Service Details Section
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(darkBlue[0], darkBlue[1], darkBlue[2]);
    doc.text('Service Details', margin, yPosition);
    yPosition += 8;
    // Underline
    doc.setDrawColor(darkBlue[0], darkBlue[1], darkBlue[2]);
    doc.setLineWidth(2);
    doc.line(margin, yPosition, pageWidth - margin, yPosition);
    yPosition += 12;

    doc.setFontSize(13);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(darkGrey[0], darkGrey[1], darkGrey[2]);
    doc.setFont('helvetica', 'bold');
    doc.text('Service Type:', margin, yPosition);
    doc.setFont('helvetica', 'normal');
    doc.text(appointment.service_type || 'N/A', margin + 50, yPosition);
    yPosition += 6;

    doc.setFont('helvetica', 'bold');
    doc.text('Cleaning Type:', margin, yPosition);
    doc.setFont('helvetica', 'normal');
    doc.text(appointment.cleaning_type || 'N/A', margin + 50, yPosition);
    yPosition += 6;

    doc.setFont('helvetica', 'bold');
    doc.text('Date:', margin, yPosition);
    doc.setFont('helvetica', 'normal');
    doc.text(formatDateInTimezone(appointment.scheduled_date, userTimezone), margin + 50, yPosition);
    yPosition += 6;

    doc.setFont('helvetica', 'bold');
    doc.text('Time:', margin, yPosition);
    doc.setFont('helvetica', 'normal');
    const timeRange = `${formatTime(appointment.scheduled_time)}${appointment.end_time ? ` - ${formatTime(appointment.end_time)}` : ''}`;
    doc.text(timeRange, margin + 50, yPosition);
    yPosition += 6;

    if (appointment.recurring_frequency) {
        doc.setFont('helvetica', 'bold');
        doc.text('Recurring:', margin, yPosition);
        doc.setFont('helvetica', 'normal');
        doc.text(appointment.recurring_frequency, margin + 50, yPosition);
        yPosition += 6;
    }

    yPosition += 10;

    // Service Address Section
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(darkBlue[0], darkBlue[1], darkBlue[2]);
    doc.text('Service Address', margin, yPosition);
    yPosition += 8;
    // Underline
    doc.line(margin, yPosition, pageWidth - margin, yPosition);
    yPosition += 12;

    doc.setFontSize(13);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(darkGrey[0], darkGrey[1], darkGrey[2]);
    const serviceAddress = `${client.service_street}${client.service_apt ? `, ${client.service_apt}` : ''}, ${client.service_city}, ${client.service_state} ${client.service_zip}`;
    doc.text(serviceAddress, margin, yPosition);
    yPosition += 20;

    // Client Information Section (without phone and email)
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(darkBlue[0], darkBlue[1], darkBlue[2]);
    doc.text('Client Information', margin, yPosition);
    yPosition += 8;
    // Underline
    doc.line(margin, yPosition, pageWidth - margin, yPosition);
    yPosition += 12;

    doc.setFontSize(13);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(darkGrey[0], darkGrey[1], darkGrey[2]);
    doc.setFont('helvetica', 'bold');
    doc.text('Name:', margin, yPosition);
    doc.setFont('helvetica', 'normal');
    doc.text(client.full_name, margin + 30, yPosition);
    yPosition += 6;

    if (client.company) {
        doc.setFont('helvetica', 'bold');
        doc.text('Company:', margin, yPosition);
        doc.setFont('helvetica', 'normal');
        doc.text(client.company, margin + 30, yPosition);
        yPosition += 6;
    }

    yPosition += 10;

    // Assigned Team Section
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(darkBlue[0], darkBlue[1], darkBlue[2]);
    doc.text('Assigned Team', margin, yPosition);
    yPosition += 8;
    // Underline
    doc.line(margin, yPosition, pageWidth - margin, yPosition);
    yPosition += 12;

    doc.setFontSize(13);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(darkGrey[0], darkGrey[1], darkGrey[2]);
    const employeeNames = employees.length > 0
        ? employees.map(e => `${e.first_name} ${e.last_name}`).join(', ')
        : 'Team will be assigned shortly';
    doc.text(employeeNames, margin, yPosition);
    yPosition += 20;

    // Payment Details Section (if deposit required)
    if (appointment.deposit_required === 'yes' && appointment.deposit_amount) {
        doc.setFontSize(16);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(darkBlue[0], darkBlue[1], darkBlue[2]);
        doc.text('Payment Details', margin, yPosition);
        yPosition += 8;
        // Underline
        doc.line(margin, yPosition, pageWidth - margin, yPosition);
        yPosition += 12;

        doc.setFontSize(13);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(darkGrey[0], darkGrey[1], darkGrey[2]);
        doc.setFont('helvetica', 'bold');
        doc.text('Deposit Required:', margin, yPosition);
        doc.setFont('helvetica', 'normal');
        doc.text(`$${formatCurrency(parseFloat(appointment.deposit_amount))}`, margin + 60, yPosition);
        yPosition += 6;

        doc.setFont('helvetica', 'bold');
        doc.text('Payment Method:', margin, yPosition);
        doc.setFont('helvetica', 'normal');
        doc.text(appointment.delivery_method || 'N/A', margin + 60, yPosition);
        yPosition += 20;
    }

    // Notes Section (if notes exist)
    if (appointment.notes) {
        doc.setFontSize(16);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(darkBlue[0], darkBlue[1], darkBlue[2]);
        doc.text('Service Notes', margin, yPosition);
        yPosition += 8;
        // Underline
        doc.line(margin, yPosition, pageWidth - margin, yPosition);
        yPosition += 12;

        doc.setFontSize(13);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(darkGrey[0], darkGrey[1], darkGrey[2]);
        // Split long notes into multiple lines if needed
        const notesLines = doc.splitTextToSize(appointment.notes, pageWidth - (margin * 2));
        doc.text(notesLines, margin, yPosition);
        yPosition += notesLines.length * 6 + 10;
    }

    // ===== CLOCK IN/OUT BUTTON SECTION =====
    const buttonY = pageHeight - 60;
    const buttonWidth = 140;
    const buttonHeight = 14;
    const buttonX = (pageWidth - buttonWidth) / 2;

    // Button background (dark blue matching header)
    doc.setFillColor(darkBlue[0], darkBlue[1], darkBlue[2]);
    doc.roundedRect(buttonX, buttonY, buttonWidth, buttonHeight, 3, 3, 'F');

    // Button text
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text('Clock In/Out & View Details', pageWidth / 2, buttonY + 9, { align: 'center' });

    // Add clickable link to the button area (dynamic based on environment)
    const employeeLoginUrl = `${appBaseUrl}/employee/login`;
    doc.link(buttonX, buttonY, buttonWidth, buttonHeight, { url: employeeLoginUrl });

    // Small text below button
    doc.setTextColor(darkGrey[0], darkGrey[1], darkGrey[2]);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text('Tap the button above to clock in/out and access job details', pageWidth / 2, buttonY + 22, { align: 'center' });

    // ===== FOOTER (Dark Blue Banner) =====
    const footerY = pageHeight - 25;
    doc.setFillColor(darkBlue[0], darkBlue[1], darkBlue[2]);
    doc.rect(0, footerY, pageWidth, 25, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(12);
    doc.setFont('helvetica', 'normal');
    doc.text('Service provided by', pageWidth / 2, footerY + 8, { align: 'center' });
    doc.text('© 2025 Thunder Pro Inc. | www.thunderpro.co', pageWidth / 2, footerY + 18, { align: 'center' });

    // Convert to Uint8Array for response
    const pdfOutput = doc.output('arraybuffer');
    return new Uint8Array(pdfOutput);
}

serve(async (req: Request): Promise<Response> => {
    return await Sentry.withScope(async (scope) => {
        Sentry.setTag("function", "download-appointment-pdf");

        if (req.method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders });
        }

        try {
            // Get appointment ID from URL query parameter
            const url = new URL(req.url);
            const appointmentId = url.searchParams.get('id');

            if (!appointmentId) {
                return new Response(
                    JSON.stringify({ error: 'Missing appointment ID parameter' }),
                    { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
                );
            }

            // Create Supabase client with service role key
            const supabase = createClient(
                Deno.env.get('SUPABASE_URL') ?? '',
                Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
            );

            // Fetch appointment
            const { data: appointment, error: appointmentError } = await supabase
                .from('route_appointments')
                .select('*')
                .eq('id', appointmentId)
                .maybeSingle();

            if (appointmentError || !appointment) {
                return new Response(
                    JSON.stringify({ error: 'Appointment not found' }),
                    { status: 404, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
                );
            }

            // Fetch client details
            const { data: client, error: clientError } = await supabase
                .from('clients')
                .select('*')
                .eq('id', appointment.client_id)
                .maybeSingle();

            if (clientError || !client) {
                return new Response(
                    JSON.stringify({ error: 'Client not found' }),
                    { status: 404, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
                );
            }

            // Fetch profile data
            const { data: profile, error: profileError } = await supabase
                .from('profiles')
                .select('*')
                .eq('user_id', appointment.user_id)
                .maybeSingle();

            if (profileError) {
                console.error('Error fetching profile:', profileError);
            }

            // Get timezone from profile or default
            const userTimezone = profile?.timezone || 'America/New_York';

            // Fetch assigned employees
            const employeeIds = Array.isArray(appointment.assigned_employees)
                ? appointment.assigned_employees
                : [];

            let employees: any[] = [];
            if (employeeIds.length > 0) {
                const { data: employeeData, error: employeeError } = await supabase
                    .from('employees')
                    .select('id, first_name, last_name')
                    .in('id', employeeIds);

                if (employeeError) {
                    console.warn('Could not load employees:', employeeError.message);
                } else {
                    employees = employeeData || [];
                }
            }

            // Get app base URL from environment (staging vs production)
            const appBaseUrl = Deno.env.get("PUBLIC_APP_URL") || Deno.env.get("APP_URL") || "https://portal.thunderpro.co";

            // Generate PDF
            const pdfBytes = await generateAppointmentPDF(
                appointment,
                client,
                employees,
                profile || {},
                userTimezone,
                appBaseUrl
            );

            // Return PDF inline so it opens in browser; user can download from viewer
            return new Response(pdfBytes, {
                status: 200,
                headers: {
                    'Content-Type': 'application/pdf',
                    'Content-Disposition': `inline; filename="Appointment_${appointment.id.substring(0, 8).toUpperCase()}.pdf"`,
                    ...corsHeaders,
                },
            });
        } catch (error: any) {
            Sentry.captureException(error);
            console.error('Error generating appointment PDF:', error);
            return new Response(
                JSON.stringify({ error: error.message }),
                { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
            );
        }
    });
});
