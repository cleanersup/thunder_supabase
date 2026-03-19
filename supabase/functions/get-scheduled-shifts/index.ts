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

    console.log('Fetching scheduled shifts for employee ID:', employeeId);

    // Get all scheduled route appointments
    const { data: appointments, error: appointmentsError } = await supabase
      .from('route_appointments')
      .select(`
        id,
        scheduled_date,
        scheduled_time,
        end_time,
        service_type,
        cleaning_type,
        assigned_employees,
        notes,
        status,
        clients:client_id (
          full_name,
          service_street,
          service_apt,
          service_city,
          service_state,
          service_zip
        )
      `)
      .gte('scheduled_date', new Date().toISOString().split('T')[0])
      .order('scheduled_date', { ascending: true });

    if (appointmentsError) {
      console.error('Error fetching appointments:', appointmentsError);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch scheduled shifts' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Total appointments found: ${appointments?.length || 0}`);

    // Filter appointments where assigned_employees contains the employeeId
    const filteredAppointments = appointments?.filter(appointment => {
      const assignedEmployees = appointment.assigned_employees || [];
      // assigned_employees can be either array of strings or array of objects {id, name}
      return assignedEmployees.some((emp: any) => {
        // Handle both formats: string ID or object with id property
        const empId = typeof emp === 'string' ? emp : emp.id;
        return empId === employeeId;
      });
    }) || [];

    console.log(`Filtered shifts for employee: ${filteredAppointments.length}`);

    // Collect all unique employee IDs from filtered appointments
    const employeeIds = new Set<string>();
    filteredAppointments.forEach(appointment => {
      const assignedEmployees = appointment.assigned_employees || [];
      assignedEmployees.forEach((emp: any) => {
        const empId = typeof emp === 'string' ? emp : emp.id;
        if (empId) employeeIds.add(empId);
      });
    });

    // Fetch employee names from the employees table
    const employeeIdsArray = Array.from(employeeIds);
    const { data: employeesData, error: employeesError } = await supabase
      .from('employees')
      .select('id, first_name, last_name')
      .in('id', employeeIdsArray);

    if (employeesError) {
      console.error('Error fetching employee data:', employeesError);
    }

    // Create a map of employee ID to full name
    const employeeNameMap = new Map<string, string>();
    if (employeesData) {
      employeesData.forEach(emp => {
        employeeNameMap.set(emp.id, `${emp.first_name} ${emp.last_name}`);
      });
    }

    console.log('Employee name map:', Object.fromEntries(employeeNameMap));

    // Transform data to required format
    const shifts = filteredAppointments.map(appointment => {
      const client = Array.isArray(appointment.clients) 
        ? appointment.clients[0] 
        : appointment.clients;
      
      const address = client 
        ? `${client.service_street}${client.service_apt ? ' ' + client.service_apt : ''}, ${client.service_city}, ${client.service_state} ${client.service_zip}`
        : 'Address not available';

      // Normalize assigned_employees to always be objects {id, name} with real names
      const assignedEmployees = (appointment.assigned_employees || []).map((emp: any) => {
        const empId = typeof emp === 'string' ? emp : emp.id;
        const empName = employeeNameMap.get(empId) || (typeof emp === 'object' ? emp.name : null) || 'Employee';
        return { id: empId, name: empName };
      });

      return {
        id: appointment.id,
        date: appointment.scheduled_date,
        start_time: appointment.scheduled_time,
        end_time: appointment.end_time,
        location: address,
        client_name: client?.full_name || 'Unknown Client',
        service_type: appointment.service_type || 'General Service',
        cleaning_type: appointment.cleaning_type,
        assigned_employees: assignedEmployees,
        instructions: appointment.notes || '',
        status: appointment.status
      };
    });

    console.log(`Returning ${shifts.length} shifts to client`);
    
    // Log the actual structure being returned for debugging
    if (shifts.length > 0) {
      console.log('Sample shift structure:', JSON.stringify(shifts[0], null, 2));
      console.log('assigned_employees type:', typeof shifts[0].assigned_employees);
      console.log('assigned_employees sample:', JSON.stringify(shifts[0].assigned_employees));
    }

    return new Response(
      JSON.stringify({
        success: true,
        shifts: shifts
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in get-scheduled-shifts function:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
