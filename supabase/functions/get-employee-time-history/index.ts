import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface TimeHistoryRequest {
  employee_id: string;
  limit?: number;
}

type ClientRow = {
  full_name: string | null;
  service_street: string | null;
  service_apt: string | null;
  service_city: string | null;
  service_state: string | null;
  service_zip: string | null;
};

type AppointmentRow = {
  id: string;
  job_id: string | null;
  service_type: string | null;
  cleaning_type: string | null;
  notes: string | null;
  clients: ClientRow | ClientRow[] | null;
};

type JobRow = {
  id: string;
  job_number: string | null;
  service_type: string | null;
  client_name: string | null;
  property_street: string | null;
  property_apt: string | null;
  property_city: string | null;
  property_state: string | null;
  property_zip: string | null;
  internal_notes: string | null;
  service_details: string | null;
};

function formatClientLocation(client: ClientRow | null | undefined): string {
  if (!client) return 'Address not available';
  return `${client.service_street ?? ''}${client.service_apt ? ' ' + client.service_apt : ''}, ${client.service_city ?? ''}, ${client.service_state ?? ''} ${client.service_zip ?? ''}`.trim()
    || 'Address not available';
}

function formatJobLocation(job: JobRow): string {
  const parts: string[] = [];
  if (job.property_street) parts.push(job.property_street);
  if (job.property_apt) parts.push(job.property_apt);
  if (job.property_city) {
    parts.push(`${job.property_city}, ${job.property_state ?? ''} ${job.property_zip ?? ''}`.trim());
  }
  return parts.join(' ') || 'Address not available';
}

function unwrapClient(clients: AppointmentRow['clients']): ClientRow | null {
  if (!clients) return null;
  return Array.isArray(clients) ? clients[0] ?? null : clients;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Missing Supabase environment variables');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { employee_id, limit = 30 }: TimeHistoryRequest = await req.json();

    if (!employee_id) {
      return new Response(
        JSON.stringify({ error: 'employee_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Fetching time history for employee: ${employee_id}, limit: ${limit}`);

    // Get completed time entries (both clock_in and clock_out are set)
    const { data: entries, error: entriesError } = await supabase
      .from('time_entries')
      .select('*')
      .eq('employee_id', employee_id)
      .not('clock_in_time', 'is', null)
      .not('clock_out_time', 'is', null)
      .order('date', { ascending: false })
      .order('clock_in_time', { ascending: false })
      .limit(limit);

    if (entriesError) {
      console.error('Error fetching time entries:', entriesError);
      throw entriesError;
    }

    const appointmentIds = [
      ...new Set(
        (entries ?? [])
          .map((e) => e.route_appointment_id as string | null)
          .filter((id): id is string => typeof id === 'string' && id.length > 0),
      ),
    ];

    const directJobIds = [
      ...new Set(
        (entries ?? [])
          .map((e) => e.job_id as string | null)
          .filter((id): id is string => typeof id === 'string' && id.length > 0),
      ),
    ];

    const appointmentById = new Map<string, AppointmentRow>();
    if (appointmentIds.length > 0) {
      const { data: appointments, error: apptError } = await supabase
        .from('route_appointments')
        .select(`
          id,
          job_id,
          service_type,
          cleaning_type,
          notes,
          clients:client_id (
            full_name,
            service_street,
            service_apt,
            service_city,
            service_state,
            service_zip
          )
        `)
        .in('id', appointmentIds);

      if (apptError) {
        console.error('Error fetching route_appointments for history:', apptError);
        throw apptError;
      }

      for (const appt of (appointments ?? []) as AppointmentRow[]) {
        appointmentById.set(appt.id, appt);
      }
    }

    const jobIdsFromAppointments = [
      ...new Set(
        [...appointmentById.values()]
          .map((a) => a.job_id)
          .filter((id): id is string => typeof id === 'string' && id.length > 0),
      ),
    ];

    const allJobIds = [...new Set([...directJobIds, ...jobIdsFromAppointments])];
    const jobById = new Map<string, JobRow>();

    if (allJobIds.length > 0) {
      const { data: jobs, error: jobsError } = await supabase
        .from('jobs')
        .select(`
          id,
          job_number,
          service_type,
          client_name,
          property_street,
          property_apt,
          property_city,
          property_state,
          property_zip,
          internal_notes,
          service_details
        `)
        .in('id', allJobIds);

      if (jobsError) {
        console.error('Error fetching jobs for history:', jobsError);
        throw jobsError;
      }

      for (const job of (jobs ?? []) as JobRow[]) {
        jobById.set(job.id, job);
      }
    }

    // Format the response - return each session individually with job/appointment context
    const history = (entries ?? []).map((entry) => {
      const breaks = [];

      // If there's a break recorded, add it to the breaks array
      if (entry.break_start_time && entry.break_end_time) {
        breaks.push({
          break_start: new Date(entry.break_start_time).toISOString(),
          break_end: new Date(entry.break_end_time).toISOString(),
        });
      }

      const appointment = entry.route_appointment_id
        ? appointmentById.get(entry.route_appointment_id) ?? null
        : null;

      const resolvedJobId =
        (typeof entry.job_id === 'string' && entry.job_id) ||
        appointment?.job_id ||
        null;
      const job = resolvedJobId ? jobById.get(resolvedJobId) ?? null : null;

      let service_type: string | null = null;
      let cleaning_type: string | null = null;
      let client_name: string | null = null;
      let location: string | null = null;
      let instructions: string | null = null;
      let job_number: string | null = null;

      // Prefer job context when linked (same shape as get-scheduled-shifts job source).
      if (job) {
        service_type = job.service_type ?? 'General Service';
        cleaning_type = null;
        client_name = job.client_name ?? 'Unknown Client';
        location = formatJobLocation(job);
        // Match get-scheduled-shifts: jobs expose internal_notes as instructions.
        instructions = job.internal_notes ?? job.service_details ?? '';
        job_number = job.job_number ?? null;
      } else if (appointment) {
        const client = unwrapClient(appointment.clients);
        service_type = appointment.service_type ?? 'General Service';
        cleaning_type = appointment.cleaning_type ?? null;
        client_name = client?.full_name ?? 'Unknown Client';
        location = formatClientLocation(client);
        instructions = appointment.notes ?? '';
        job_number = null;
      }

      return {
        id: entry.id, // Include session ID for reference
        date: entry.date,
        clock_in: new Date(entry.clock_in_time).toISOString(),
        clock_out: new Date(entry.clock_out_time).toISOString(),
        total_hours: entry.total_hours || 0,
        total_break_minutes: entry.total_break_minutes || 0,
        breaks,
        status: entry.status,
        notes: entry.notes || null,
        route_appointment_id: entry.route_appointment_id || null,
        job_id: resolvedJobId,
        service_type,
        cleaning_type,
        client_name,
        location,
        instructions,
        job_number,
      };
    });

    console.log(`Found ${history.length} completed shifts`);

    return new Response(
      JSON.stringify({
        success: true,
        history,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in get-employee-time-history:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return new Response(
      JSON.stringify({ error: errorMessage, success: false }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
