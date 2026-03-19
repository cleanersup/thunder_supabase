import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ClockSessionRequest {
  employee_id: string;
  local_date?: string; // YYYY-MM-DD format from employee's local timezone
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

    const { employee_id, local_date }: ClockSessionRequest = await req.json();

    if (!employee_id) {
      return new Response(
        JSON.stringify({ error: 'employee_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Checking active session for employee: ${employee_id}`);

    // Use employee's local date if provided, otherwise fallback to server UTC date
    const today = local_date || new Date().toISOString().split('T')[0];
    console.log(`Using date: ${today} (local_date provided: ${local_date ? 'yes' : 'no'})`);

    // Find the latest time entry that has clock_in but no clock_out for today
    const { data: activeEntry, error: entryError } = await supabase
      .from('time_entries')
      .select('*')
      .eq('employee_id', employee_id)
      .eq('date', today)
      .not('clock_in_time', 'is', null)
      .is('clock_out_time', null)
      .order('clock_in_time', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (entryError) {
      console.error('Error fetching time entry:', entryError);
      throw entryError;
    }

    if (!activeEntry) {
      console.log('No active session found');
      return new Response(
        JSON.stringify({
          has_active_session: false,
          session: null
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if employee is currently on break
    const isOnBreak = activeEntry.break_start_time !== null && activeEntry.break_end_time === null;

    // Calculate total break time in seconds
    let totalBreakSeconds = 0;
    
    if (activeEntry.break_start_time && activeEntry.break_end_time) {
      // If there's a completed break, calculate its duration
      const breakStart = new Date(activeEntry.break_start_time).getTime();
      const breakEnd = new Date(activeEntry.break_end_time).getTime();
      totalBreakSeconds = Math.floor((breakEnd - breakStart) / 1000);
    }

    console.log('Active session found:', {
      entry_id: activeEntry.id,
      is_on_break: isOnBreak,
      total_break_seconds: totalBreakSeconds
    });

    return new Response(
      JSON.stringify({
        has_active_session: true,
        session: {
          entry_id: activeEntry.id,
          clock_in_time: activeEntry.clock_in_time,
          is_on_break: isOnBreak,
          last_break_start: activeEntry.break_start_time,
          total_break_seconds: totalBreakSeconds,
          status: activeEntry.status
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in get-active-clock-session:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
