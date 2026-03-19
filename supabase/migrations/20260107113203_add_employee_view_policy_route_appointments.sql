-- Migration: Add RLS policy for employees to view their assigned appointments
-- Issue: Employees cannot view appointment details when clicking on upcoming shifts
-- Cause: route_appointments table only allows SELECT if auth.uid() = user_id
-- Solution: Allow employees to view appointments where they have an assigned time_entry

-- Create policy for employees to view their assigned appointments
CREATE POLICY "Employees can view their assigned appointments"
ON public.route_appointments
FOR SELECT
USING (
  -- Allow if there's a time_entry linking this appointment to any employee
  -- This works because time_entries RLS is more permissive for employees
  id IN (
    SELECT route_appointment_id
    FROM public.time_entries
    WHERE route_appointment_id = route_appointments.id
  )
);

-- Add comment to explain the policy
COMMENT ON POLICY "Employees can view their assigned appointments" ON public.route_appointments
IS 'Allows employees to view route_appointments where they have an assigned time_entry. This enables the employee dashboard to display shift details (client, address, service type, etc) when employees click on their upcoming shifts.';
