import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RequestBody {
  employeeId: string;
  /** Optional. If provided, only shifts from this date onward are returned (YYYY-MM-DD).
   *  Defaults to today (server UTC). */
  from_date?: string;
  /** Optional. If provided, only shifts up to and including this date are returned (YYYY-MM-DD).
   *  Allows calendar screens to fetch past weeks/months. */
  to_date?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error("Missing environment variables");
      return new Response(
        JSON.stringify({ error: "Server configuration error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { employeeId, from_date, to_date }: RequestBody = await req.json();

    if (!employeeId) {
      return new Response(
        JSON.stringify({ error: "Employee ID is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const today = new Date().toISOString().split("T")[0];
    const startDate = from_date || today;

    console.log(`Fetching shifts for employee ${employeeId} from ${startDate}${to_date ? ` to ${to_date}` : " onward"}`);

    // ── SOURCE 1: route_appointments ──────────────────────────────────────────
    // Exclude route_appointment mirrors of published jobs (sync_job_to_route_appointment sets job_id).
    // Those shifts are returned from the jobs source with property_* address fields.
    let apptQuery = supabase
      .from("route_appointments")
      .select(`
        id,
        job_id,
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
      .is("job_id", null)
      .gte("scheduled_date", startDate)
      .order("scheduled_date", { ascending: true });

    if (to_date) {
      apptQuery = apptQuery.lte("scheduled_date", to_date);
    }

    const { data: appointments, error: appointmentsError } = await apptQuery;

    if (appointmentsError) {
      console.error("Error fetching appointments:", appointmentsError);
      return new Response(
        JSON.stringify({ error: "Failed to fetch scheduled shifts" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Filter appointments assigned to this employee
    const filteredAppointments = (appointments ?? []).filter((appt) => {
      const assigned = appt.assigned_employees || [];
      return assigned.some((emp: unknown) => {
        const id = typeof emp === "string" ? emp : (emp as { id: string }).id;
        return id === employeeId;
      });
    });

    // ── SOURCE 2: jobs ────────────────────────────────────────────────────────
    // Jobs store assigned_employees as [{id, name, ...}] JSONB.
    // We pull upcoming/today/ongoing jobs and filter by employee in memory
    // (same pattern as appointments — no JSON operator needed).
    let jobsQuery = supabase
      .from("jobs")
      .select(`
        id,
        job_number,
        scheduled_date,
        start_time,
        end_time,
        service_type,
        service_details,
        assigned_employees,
        internal_notes,
        status,
        client_id,
        client_name,
        property_street,
        property_apt,
        property_city,
        property_state,
        property_zip,
        site_latitude,
        site_longitude,
        geofence_radius_meters
      `)
      .gte("scheduled_date", startDate)
      .not("status", "in", '("draft","cancelled")')
      .order("scheduled_date", { ascending: true });

    if (to_date) {
      jobsQuery = jobsQuery.lte("scheduled_date", to_date);
    }

    const { data: jobs, error: jobsError } = await jobsQuery;

    if (jobsError) {
      console.error("Error fetching jobs:", jobsError);
      // Non-fatal: fall back to appointments only
    }

    const filteredJobs = (jobs ?? []).filter((job) => {
      const assigned = (job.assigned_employees as unknown[]) || [];
      return assigned.some((emp: unknown) => {
        if (typeof emp === "string") return emp === employeeId;
        if (typeof emp === "object" && emp !== null) {
          return (emp as { id: string }).id === employeeId;
        }
        return false;
      });
    });

    // ── Collect all unique employee IDs (both sources) ────────────────────────
    const employeeIds = new Set<string>();

    for (const appt of filteredAppointments) {
      for (const emp of (appt.assigned_employees || []) as unknown[]) {
        const id = typeof emp === "string" ? emp : (emp as { id: string }).id;
        if (id) employeeIds.add(id);
      }
    }
    for (const job of filteredJobs) {
      for (const emp of ((job.assigned_employees as unknown[]) || [])) {
        const id = typeof emp === "string" ? emp : (emp as { id: string }).id;
        if (id) employeeIds.add(id);
      }
    }

    // ── Fetch employee names once ─────────────────────────────────────────────
    const employeeNameMap = new Map<string, string>();
    const idsArray = Array.from(employeeIds);
    if (idsArray.length > 0) {
      const { data: empData } = await supabase
        .from("employees")
        .select("id, first_name, last_name")
        .in("id", idsArray);

      if (empData) {
        for (const emp of empData) {
          employeeNameMap.set(emp.id, `${emp.first_name} ${emp.last_name}`);
        }
      }
    }

    function normalizeEmployees(raw: unknown[]): { id: string; name: string }[] {
      return raw.map((emp) => {
        const id = typeof emp === "string" ? emp : (emp as { id: string }).id;
        const fallbackName = typeof emp === "object" && emp !== null
          ? (emp as { name?: string }).name ?? "Employee"
          : "Employee";
        return { id, name: employeeNameMap.get(id) ?? fallbackName };
      });
    }

    // ── Transform appointments ────────────────────────────────────────────────
    const appointmentShifts = filteredAppointments.map((appt) => {
      const client = Array.isArray(appt.clients) ? appt.clients[0] : appt.clients;
      const address = client
        ? `${client.service_street}${client.service_apt ? " " + client.service_apt : ""}, ${client.service_city}, ${client.service_state} ${client.service_zip}`
        : "Address not available";

      return {
        id: appt.id,
        source: "appointment" as const,
        job_number: null,
        date: appt.scheduled_date,
        start_time: appt.scheduled_time,
        end_time: appt.end_time,
        location: address,
        client_name: client?.full_name ?? "Unknown Client",
        service_type: appt.service_type ?? "General Service",
        cleaning_type: appt.cleaning_type ?? null,
        assigned_employees: normalizeEmployees(appt.assigned_employees || []),
        instructions: appt.notes ?? "",
        status: appt.status,
        site_latitude: null,
        site_longitude: null,
        geofence_radius_meters: null,
      };
    });

    // ── Transform jobs ────────────────────────────────────────────────────────
    const jobShifts = filteredJobs.map((job) => {
      const parts = [job.property_street];
      if (job.property_apt) parts.push(job.property_apt);
      if (job.property_city) parts.push(`${job.property_city}, ${job.property_state} ${job.property_zip}`);
      const address = parts.join(" ") || "Address not available";

      if (job.site_latitude == null || job.site_longitude == null) {
        // The app must geocode this address at clock-in; if that fails it blocks
        // with "Couldn't verify the job site location". Log the exact string it
        // will try so a failing address is obvious from the server side.
        console.warn(
          `get-scheduled-shifts: job has no stored site coordinates: job_id=${job.id} ` +
          `job_number=${job.job_number ?? "n/a"} site_latitude=${job.site_latitude} ` +
          `site_longitude=${job.site_longitude} status=${job.status} ` +
          `address_to_geocode="${address}" ` +
          `street="${job.property_street ?? ""}" city="${job.property_city ?? ""}" ` +
          `state="${job.property_state ?? ""}" zip="${job.property_zip ?? ""}"`,
        );
      }

      return {
        id: job.id,
        source: "job" as const,
        job_number: job.job_number ?? null,
        date: job.scheduled_date,
        start_time: job.start_time ?? null,
        end_time: job.end_time ?? null,
        location: address,
        client_name: job.client_name ?? "Unknown Client",
        service_type: job.service_type ?? "General Service",
        cleaning_type: null,
        assigned_employees: normalizeEmployees((job.assigned_employees as unknown[]) || []),
        instructions: job.internal_notes ?? "",
        status: job.status,
        site_latitude: job.site_latitude ?? null,
        site_longitude: job.site_longitude ?? null,
        geofence_radius_meters: job.geofence_radius_meters ?? 200,
      };
    });

    // ── Merge & sort by date then start_time ──────────────────────────────────
    const allShifts = [...appointmentShifts, ...jobShifts].sort((a, b) => {
      const dateCmp = a.date.localeCompare(b.date);
      if (dateCmp !== 0) return dateCmp;
      const aTime = a.start_time ?? "";
      const bTime = b.start_time ?? "";
      return aTime.localeCompare(bTime);
    });

    console.log(`Returning ${allShifts.length} shifts (${appointmentShifts.length} appointments + ${jobShifts.length} jobs)`);

    const jobsWithCoords = filteredJobs.filter(
      (j) => j.site_latitude != null && j.site_longitude != null,
    ).length;
    console.log(
      `get-scheduled-shifts summary: employee_id=${employeeId} jobs=${filteredJobs.length} ` +
      `jobs_with_stored_coords=${jobsWithCoords} jobs_missing_coords=${filteredJobs.length - jobsWithCoords}`,
    );

    return new Response(
      JSON.stringify({ success: true, shifts: allShifts }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("Error in get-scheduled-shifts:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
