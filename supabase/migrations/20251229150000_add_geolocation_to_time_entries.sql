-- Add geolocation fields to time_entries table
-- These fields are used by the employee-clock-action edge function

ALTER TABLE public.time_entries
ADD COLUMN IF NOT EXISTS clock_in_latitude NUMERIC(10, 8),
ADD COLUMN IF NOT EXISTS clock_in_longitude NUMERIC(11, 8),
ADD COLUMN IF NOT EXISTS clock_out_latitude NUMERIC(10, 8),
ADD COLUMN IF NOT EXISTS clock_out_longitude NUMERIC(11, 8);

-- Add comments to explain the fields
COMMENT ON COLUMN public.time_entries.clock_in_latitude IS 'Latitude coordinate where employee clocked in';
COMMENT ON COLUMN public.time_entries.clock_in_longitude IS 'Longitude coordinate where employee clocked in';
COMMENT ON COLUMN public.time_entries.clock_out_latitude IS 'Latitude coordinate where employee clocked out';
COMMENT ON COLUMN public.time_entries.clock_out_longitude IS 'Longitude coordinate where employee clocked out';
