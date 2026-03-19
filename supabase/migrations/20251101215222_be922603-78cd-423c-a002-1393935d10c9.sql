-- Function to calculate total hours and break minutes for time entries
CREATE OR REPLACE FUNCTION public.calculate_time_entry_totals()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  work_minutes numeric;
  break_minutes numeric;
BEGIN
  -- Calculate total break time in minutes
  IF NEW.break_start_time IS NOT NULL AND NEW.break_end_time IS NOT NULL THEN
    break_minutes := EXTRACT(EPOCH FROM (NEW.break_end_time - NEW.break_start_time)) / 60;
    NEW.total_break_minutes := ROUND(break_minutes);
  ELSE
    NEW.total_break_minutes := 0;
  END IF;

  -- Calculate total work hours
  IF NEW.clock_in_time IS NOT NULL AND NEW.clock_out_time IS NOT NULL THEN
    -- Calculate total minutes worked (including breaks)
    work_minutes := EXTRACT(EPOCH FROM (NEW.clock_out_time - NEW.clock_in_time)) / 60;
    
    -- Subtract break time to get actual work time in hours
    NEW.total_hours := ROUND((work_minutes - COALESCE(NEW.total_break_minutes, 0)) / 60, 2);
  ELSE
    NEW.total_hours := NULL;
  END IF;

  RETURN NEW;
END;
$$;

-- Create trigger to automatically calculate totals
DROP TRIGGER IF EXISTS calculate_time_entry_totals_trigger ON public.time_entries;
CREATE TRIGGER calculate_time_entry_totals_trigger
  BEFORE INSERT OR UPDATE ON public.time_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.calculate_time_entry_totals();