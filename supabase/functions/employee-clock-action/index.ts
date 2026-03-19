import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
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

interface ClockActionRequest {
  employee_id: string;
  phone: string;
  action: 'clock_in' | 'clock_out' | 'break_start' | 'break_end';
  route_appointment_id?: string;
  notes?: string;
  local_date?: string; // YYYY-MM-DD format from client's local timezone
  latitude?: number;
  longitude?: number;
}

serve(async (req) => {
  return await Sentry.withScope(async (scope) => {
    Sentry.setTag("function", "employee-clock-action");

    try {
      // Handle CORS preflight requests
      if (req.method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders });
      }

      const { employee_id, phone, action, route_appointment_id, notes, local_date, latitude, longitude }: ClockActionRequest = await req.json();

        Sentry.setTag("action", action);
        Sentry.addBreadcrumb({ message: `Clock action: ${action} for employee ${employee_id}`, level: "info" });
        console.log(`Clock action request: ${action} for employee ${employee_id}`);

        // Validate required fields
        if (!employee_id || !phone || !action) {
          return new Response(
            JSON.stringify({ error: 'Missing required fields: employee_id, phone, and action are required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Initialize Supabase client
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        // Verify employee exists and get their user_id
        const { data: employee, error: employeeError } = await supabase
          .from('employees')
          .select('id, user_id, phone, first_name, last_name')
          .eq('id', employee_id)
          .eq('phone', phone)
          .maybeSingle();

        if (employeeError || !employee) {
          console.error('Employee not found or phone mismatch:', employeeError);
          return new Response(
            JSON.stringify({ error: 'Employee not found or phone number does not match' }),
            { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        Sentry.setUser({ id: employee.id });
        Sentry.addBreadcrumb({ message: "Employee verified", level: "info" });

        // Use client's local date if provided, otherwise fallback to server UTC date
        const today = local_date || new Date().toISOString().split('T')[0];
        const now = new Date().toISOString();

        console.log(`Using date: ${today} (local_date provided: ${local_date ? 'yes' : 'no'})`);

        // Get today's time entry for this employee
        // First, try to find an active session (clocked in but not out)
        let existingEntry = null;

        const { data: activeEntry, error: activeError } = await supabase
          .from('time_entries')
          .select('*')
          .eq('employee_id', employee_id)
          .eq('date', today)
          .not('clock_in_time', 'is', null)  // Must have clocked in
          .is('clock_out_time', null)        // Must not have clocked out yet
          .order('clock_in_time', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (activeEntry) {
          existingEntry = activeEntry;
          console.log('Found active session:', { id: activeEntry.id, status: activeEntry.status });
        } else {
          // If no active session, look for a scheduled entry (created by admin)
          const { data: scheduledEntry, error: scheduledError } = await supabase
            .from('time_entries')
            .select('*')
            .eq('employee_id', employee_id)
            .eq('date', today)
            .eq('status', 'scheduled')
            .is('clock_in_time', null)
            .order('created_at', { ascending: true })
            .limit(1)
            .maybeSingle();

          if (scheduledEntry) {
            existingEntry = scheduledEntry;
            console.log('Found scheduled entry:', { id: scheduledEntry.id, status: scheduledEntry.status });
          }
        }

        console.log('Entry to use:', existingEntry ? { id: existingEntry.id, status: existingEntry.status } : 'None - will create new');

        let timeEntry;

        // Handle different actions
        switch (action) {
          case 'clock_in':
            // If no route_appointment_id provided, try to find today's appointment for this employee
            let appointmentId = route_appointment_id;

            if (!appointmentId) {
              console.log('No route_appointment_id provided, searching for today\'s appointment...');
              const { data: todaysAppointments } = await supabase
                .from('route_appointments')
                .select('id')
                .eq('user_id', employee.user_id)
                .eq('scheduled_date', today)
                .contains('assigned_employees', [employee_id])
                .limit(1)
                .maybeSingle();

              if (todaysAppointments) {
                appointmentId = todaysAppointments.id;
                console.log(`Found today's appointment: ${appointmentId}`);
              } else {
                console.log('No appointment found for today');
              }
            }

            if (existingEntry) {
              // Update existing entry
              const { data, error } = await supabase
                .from('time_entries')
                .update({
                  clock_in_time: now,
                  status: 'in_progress',
                  route_appointment_id: appointmentId || existingEntry.route_appointment_id,
                  notes: notes || existingEntry.notes,
                  clock_in_latitude: latitude || existingEntry.clock_in_latitude,
                  clock_in_longitude: longitude || existingEntry.clock_in_longitude,
                })
                .eq('id', existingEntry.id)
                .select()
                .single();

              if (error) throw error;
              timeEntry = data;
              console.log(`Updated clock_in for employee ${employee_id}`);
            } else {
              // Create new entry
              const { data, error } = await supabase
                .from('time_entries')
                .insert({
                  employee_id,
                  user_id: employee.user_id,
                  date: today,
                  clock_in_time: now,
                  status: 'in_progress',
                  route_appointment_id: appointmentId || null,
                  notes: notes || null,
                  clock_in_latitude: latitude || null,
                  clock_in_longitude: longitude || null,
                })
                .select()
                .single();

              if (error) throw error;
              timeEntry = data;
              console.log(`Created new time entry with clock_in for employee ${employee_id}`);
            }

            // Send clock-in notifications (don't wait for it)
            // ALWAYS send notification - if there's an appointment, it notifies client and owner
            // If NO appointment, it only notifies owner that employee clocked in
            console.log(`Triggering clock-in notifications for time entry ${timeEntry.id}`);
            supabase.functions.invoke('send-clock-notifications', {
              body: { timeEntryId: timeEntry.id, eventType: 'clock_in' }
            }).then(() => console.log('Clock-in notifications triggered'))
              .catch(err => console.error('Error sending clock-in notifications:', err));
            break;

          case 'clock_out':
            if (!existingEntry) {
              return new Response(
                JSON.stringify({ error: 'No active time entry found for today. Please clock in first.' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
              );
            }

            // Verify the entry is active (in_progress or on_break)
            if (existingEntry.status !== 'in_progress' && existingEntry.status !== 'on_break') {
              return new Response(
                JSON.stringify({ error: 'Cannot clock out. The time entry is not active. Current status: ' + existingEntry.status }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
              );
            }

            const { data: clockOutData, error: clockOutError } = await supabase
              .from('time_entries')
              .update({
                clock_out_time: now,
                status: 'completed',
                notes: notes || existingEntry.notes,
                clock_out_latitude: latitude || null,
                clock_out_longitude: longitude || null,
              })
              .eq('id', existingEntry.id)
              .select()
              .single();

            if (clockOutError) throw clockOutError;
            timeEntry = clockOutData;
            console.log(`Clock out for employee ${employee_id}`);

            // Send clock-out notifications (don't wait for it)
            // ALWAYS send notification - if there's an appointment, it notifies client and owner
            // If NO appointment, it only notifies owner that employee clocked out
            console.log(`Triggering clock-out notifications for time entry ${timeEntry.id}`);
            supabase.functions.invoke('send-clock-notifications', {
              body: { timeEntryId: timeEntry.id, eventType: 'clock_out' }
            }).then(() => console.log('Clock-out notifications triggered'))
              .catch(err => console.error('Error sending clock-out notifications:', err));
            break;

          case 'break_start':
            if (!existingEntry) {
              return new Response(
                JSON.stringify({ error: 'No active time entry found for today. Please clock in first.' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
              );
            }

            // Verify the entry is in progress (not already on break or completed)
            if (existingEntry.status !== 'in_progress') {
              return new Response(
                JSON.stringify({ error: 'Cannot start break. The time entry is not in progress. Current status: ' + existingEntry.status }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
              );
            }

            console.log(`Starting break for entry ${existingEntry.id}, current status: ${existingEntry.status}`);

            const { data: breakStartData, error: breakStartError } = await supabase
              .from('time_entries')
              .update({
                break_start_time: now,
                break_end_time: null,  // CRITICAL: clear previous break_end_time
                status: 'on_break',  // CRITICAL: must change status to on_break
                notes: notes || existingEntry.notes,
              })
              .eq('id', existingEntry.id)
              .select()
              .single();

            if (breakStartError) {
              console.error('Error updating break_start:', breakStartError);
              throw breakStartError;
            }

            timeEntry = breakStartData;
            console.log(`Break started successfully for employee ${employee_id}, new status: ${breakStartData?.status}`);
            break;

          case 'break_end':
            if (!existingEntry) {
              return new Response(
                JSON.stringify({ error: 'No active time entry found for today. Please clock in first.' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
              );
            }

            // Verify the entry is on break
            if (existingEntry.status !== 'on_break') {
              return new Response(
                JSON.stringify({ error: 'Cannot end break. You are not currently on break. Current status: ' + existingEntry.status }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
              );
            }

            const { data: breakEndData, error: breakEndError } = await supabase
              .from('time_entries')
              .update({
                break_end_time: now,
                status: 'in_progress',
                notes: notes || existingEntry.notes,
              })
              .eq('id', existingEntry.id)
              .select()
              .single();

            if (breakEndError) throw breakEndError;
            timeEntry = breakEndData;
            console.log(`Break end for employee ${employee_id}`);
            break;

          default:
            return new Response(
              JSON.stringify({ error: 'Invalid action. Must be one of: clock_in, clock_out, break_start, break_end' }),
              { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

      return new Response(
        JSON.stringify({
          success: true,
          action,
          employee: {
            id: employee.id,
            name: `${employee.first_name} ${employee.last_name}`,
          },
          time_entry: timeEntry,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    } catch (error) {
      Sentry.captureException(error);
      console.error('Error in employee-clock-action:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      return new Response(
        JSON.stringify({ error: errorMessage }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
  });
});
