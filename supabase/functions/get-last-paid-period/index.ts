import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RequestBody {
  employeeId: string;
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('Missing environment variables');
      return new Response(
        JSON.stringify({ error: 'Server configuration error' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Parse request body
    const { employeeId }: RequestBody = await req.json();

    if (!employeeId) {
      return new Response(
        JSON.stringify({ error: 'Employee ID is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Fetching last paid period for employee:', employeeId);

    // Get the last paid period for this employee
    const { data: lastPaidPeriod, error: periodError } = await supabase
      .from('paid_periods')
      .select('*')
      .eq('employee_id', employeeId)
      .order('end_date', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (periodError) {
      console.error('Error fetching paid period:', periodError);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch paid period' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get employee data to fetch hourly_pay
    const { data: employee, error: employeeError } = await supabase
      .from('employees')
      .select('hourly_pay')
      .eq('id', employeeId)
      .maybeSingle();

    if (employeeError) {
      console.error('Error fetching employee:', employeeError);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch employee data' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!employee) {
      return new Response(
        JSON.stringify({ error: 'Employee not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const hourlyPay = employee.hourly_pay || 0;

    // If no paid period exists, return only YTD as 0
    if (!lastPaidPeriod) {
      console.log('No paid period found for employee');
      return new Response(
        JSON.stringify({
          success: true,
          lastPaidPeriod: null,
          ytdEarnings: 0,
          year: new Date().getFullYear()
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Last paid period found:', lastPaidPeriod);

    // Get all completed time entries for this employee in the last paid period
    const { data: lastPeriodEntries, error: entriesError } = await supabase
      .from('time_entries')
      .select('total_hours')
      .eq('employee_id', employeeId)
      .eq('status', 'completed')
      .gte('date', lastPaidPeriod.start_date)
      .lte('date', lastPaidPeriod.end_date);

    if (entriesError) {
      console.error('Error fetching time entries:', entriesError);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch time entries' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Calculate total hours for last period
    const lastPeriodHours = lastPeriodEntries?.reduce((sum, entry) => {
      return sum + (entry.total_hours || 0);
    }, 0) || 0;

    const lastPeriodEarnings = lastPeriodHours * hourlyPay;

    console.log('Last period - Hours:', lastPeriodHours, 'Earnings:', lastPeriodEarnings);

    // Calculate YTD Earnings (all paid periods in current year)
    const currentYear = new Date().getFullYear();
    const yearStart = `${currentYear}-01-01`;
    const yearEnd = `${currentYear}-12-31`;

    // Get all paid periods for this employee in the current year
    const { data: allYearPeriods, error: yearPeriodsError } = await supabase
      .from('paid_periods')
      .select('start_date, end_date')
      .eq('employee_id', employeeId)
      .gte('end_date', yearStart)
      .lte('end_date', yearEnd);

    if (yearPeriodsError) {
      console.error('Error fetching year periods:', yearPeriodsError);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch year periods' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Calculate total earnings for all periods in the year
    let ytdEarnings = 0;

    if (allYearPeriods && allYearPeriods.length > 0) {
      for (const period of allYearPeriods) {
        const { data: periodEntries } = await supabase
          .from('time_entries')
          .select('total_hours')
          .eq('employee_id', employeeId)
          .eq('status', 'completed')
          .gte('date', period.start_date)
          .lte('date', period.end_date);

        const periodHours = periodEntries?.reduce((sum, entry) => {
          return sum + (entry.total_hours || 0);
        }, 0) || 0;

        ytdEarnings += periodHours * hourlyPay;
      }
    }

    console.log('YTD Earnings:', ytdEarnings, 'for year:', currentYear);

    // Return the last paid period with calculated values + YTD
    return new Response(
      JSON.stringify({
        success: true,
        lastPaidPeriod: {
          start_date: lastPaidPeriod.start_date,
          end_date: lastPaidPeriod.end_date,
          total_hours: lastPeriodHours,
          total_earnings: lastPeriodEarnings,
          hourly_pay: hourlyPay
        },
        ytdEarnings: ytdEarnings,
        year: currentYear
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in get-last-paid-period function:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
