-- Add timezone support to route_appointments for proper UTC storage
-- The system will work as follows:
-- 1. All timestamps (clock_in_time, clock_out_time) are already stored in UTC (timestamptz)
-- 2. Each user's profile.timezone stores their business timezone (already exists)
-- 3. For scheduled appointments, we add UTC timestamp columns

-- Add columns for UTC timestamps of scheduled appointments
ALTER TABLE public.route_appointments 
ADD COLUMN IF NOT EXISTS scheduled_datetime timestamptz,
ADD COLUMN IF NOT EXISTS end_datetime timestamptz;

-- Add index for better performance
CREATE INDEX IF NOT EXISTS idx_route_appointments_scheduled_datetime 
ON public.route_appointments(scheduled_datetime);

CREATE INDEX IF NOT EXISTS idx_route_appointments_scheduled_date_time 
ON public.route_appointments(scheduled_date, scheduled_time);

-- Add comments explaining the timezone strategy
COMMENT ON COLUMN public.profiles.timezone IS 'Business timezone for this user. All appointment times are stored in UTC but displayed in this timezone.';
COMMENT ON COLUMN public.employees.timezone IS 'Employee timezone. Clock times are stored in UTC but displayed in this timezone.';
COMMENT ON COLUMN public.route_appointments.scheduled_datetime IS 'Scheduled start time in UTC. Calculated from scheduled_date + scheduled_time in user timezone.';
COMMENT ON COLUMN public.route_appointments.end_datetime IS 'Scheduled end time in UTC. Calculated from scheduled_date + end_time in user timezone.';

-- Note: We keep scheduled_date and scheduled_time for backward compatibility
-- Frontend will gradually migrate to use scheduled_datetime instead