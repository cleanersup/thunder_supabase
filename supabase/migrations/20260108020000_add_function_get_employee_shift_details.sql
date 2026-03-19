-- Migration: Create SECURITY DEFINER function to get employee shift details
-- This bypasses RLS after validating the employee has access to the time_entry
-- Uses the same pattern as is_valid_employee_for_entry function

CREATE OR REPLACE FUNCTION public.get_employee_shift_details(
  _time_entry_id uuid,
  _employee_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _time_entry record;
  _appointment record;
  _client record;
  _result jsonb;
BEGIN
  -- Step 1: Verify that this employee is assigned to this time_entry
  SELECT * INTO _time_entry
  FROM time_entries
  WHERE id = _time_entry_id
    AND employee_id = _employee_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Shift not found or you do not have access';
  END IF;

  -- Step 2: Get appointment if exists
  IF _time_entry.route_appointment_id IS NOT NULL THEN
    BEGIN
      SELECT * INTO STRICT _appointment
      FROM route_appointments
      WHERE id = _time_entry.route_appointment_id;

      -- Step 3: Get client if exists
      IF _appointment.client_id IS NOT NULL THEN
        BEGIN
          SELECT * INTO STRICT _client
          FROM clients
          WHERE id = _appointment.client_id;
        EXCEPTION
          WHEN NO_DATA_FOUND THEN
            -- Client not found, continue with null client
            NULL;
        END;
      END IF;
    EXCEPTION
      WHEN NO_DATA_FOUND THEN
        -- Appointment not found, continue with null appointment
        NULL;
    END;
  END IF;

  -- Step 4: Build response JSON
  _result := jsonb_build_object(
    'timeEntry', to_jsonb(_time_entry),
    'appointment', CASE
      WHEN _appointment.id IS NOT NULL THEN
        jsonb_build_object(
          'id', _appointment.id,
          'scheduled_date', _appointment.scheduled_date,
          'scheduled_time', _appointment.scheduled_time,
          'end_time', _appointment.end_time,
          'service_type', _appointment.service_type,
          'cleaning_type', _appointment.cleaning_type,
          'assigned_employees', _appointment.assigned_employees,
          'notes', _appointment.notes,
          'status', _appointment.status,
          'clients', CASE
            WHEN _client.id IS NOT NULL THEN
              jsonb_build_object(
                'full_name', _client.full_name,
                'service_street', _client.service_street,
                'service_apt', _client.service_apt,
                'service_city', _client.service_city,
                'service_state', _client.service_state,
                'service_zip', _client.service_zip
              )
            ELSE NULL
          END
        )
      ELSE NULL
    END
  );

  RETURN _result;
END;
$$;

COMMENT ON FUNCTION public.get_employee_shift_details IS 'Returns shift details for an employee including client data. Validates that the employee is assigned to the time_entry before returning any data. Uses SECURITY DEFINER to bypass RLS after validation.';
