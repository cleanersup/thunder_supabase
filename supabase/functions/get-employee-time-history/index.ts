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

    // Format the response - return each session individually
    const history = entries.map((entry) => {
      const breaks = [];
      
      // If there's a break recorded, add it to the breaks array
      if (entry.break_start_time && entry.break_end_time) {
        breaks.push({
          break_start: new Date(entry.break_start_time).toISOString(),
          break_end: new Date(entry.break_end_time).toISOString(),
        });
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
