-- Add timezone fields to employees and profiles tables
ALTER TABLE public.employees 
ADD COLUMN timezone TEXT DEFAULT 'America/New_York';

ALTER TABLE public.profiles 
ADD COLUMN timezone TEXT DEFAULT 'America/New_York';

-- Add comment to explain the timezone fields
COMMENT ON COLUMN public.employees.timezone IS 'IANA timezone identifier for the employee (e.g., America/New_York, America/Los_Angeles)';
COMMENT ON COLUMN public.profiles.timezone IS 'IANA timezone identifier for the user (e.g., America/New_York, America/Los_Angeles)';