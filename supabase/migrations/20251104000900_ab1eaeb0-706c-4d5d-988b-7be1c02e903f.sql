-- Add location columns to time_entries table
ALTER TABLE public.time_entries 
ADD COLUMN IF NOT EXISTS clock_in_latitude numeric,
ADD COLUMN IF NOT EXISTS clock_in_longitude numeric,
ADD COLUMN IF NOT EXISTS clock_out_latitude numeric,
ADD COLUMN IF NOT EXISTS clock_out_longitude numeric;

-- Add comments
COMMENT ON COLUMN public.time_entries.clock_in_latitude IS 'Latitude where employee clocked in';
COMMENT ON COLUMN public.time_entries.clock_in_longitude IS 'Longitude where employee clocked in';
COMMENT ON COLUMN public.time_entries.clock_out_latitude IS 'Latitude where employee clocked out';
COMMENT ON COLUMN public.time_entries.clock_out_longitude IS 'Longitude where employee clocked out';