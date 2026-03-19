-- Create employee_shifts table
CREATE TABLE public.employee_shifts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'scheduled', 'cancelled')),

  -- Scheduled times (for planned shifts)
  scheduled_start TIMESTAMP WITH TIME ZONE,
  scheduled_end TIMESTAMP WITH TIME ZONE,

  -- Actual clock in/out times
  actual_start TIMESTAMP WITH TIME ZONE,
  actual_end TIMESTAMP WITH TIME ZONE,

  -- Location data (stored as "latitude,longitude" string)
  clock_in_location TEXT,
  clock_out_location TEXT,

  -- Optional: Link to appointment if shift is for a specific job
  appointment_id UUID,

  -- Notes
  notes TEXT,

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Add indexes for common queries
CREATE INDEX idx_employee_shifts_employee_id ON public.employee_shifts(employee_id);
CREATE INDEX idx_employee_shifts_user_id ON public.employee_shifts(user_id);
CREATE INDEX idx_employee_shifts_status ON public.employee_shifts(status);
CREATE INDEX idx_employee_shifts_scheduled_start ON public.employee_shifts(scheduled_start);
CREATE INDEX idx_employee_shifts_actual_start ON public.employee_shifts(actual_start);

-- Enable Row Level Security
ALTER TABLE public.employee_shifts ENABLE ROW LEVEL SECURITY;

-- Create policies for employee access (employees can only see their own shifts)
CREATE POLICY "Employees can view their own shifts"
ON public.employee_shifts
FOR SELECT
USING (true);

CREATE POLICY "Employees can create their own shifts"
ON public.employee_shifts
FOR INSERT
WITH CHECK (true);

CREATE POLICY "Employees can update their own shifts"
ON public.employee_shifts
FOR UPDATE
USING (true);

CREATE POLICY "Employees can delete their own shifts"
ON public.employee_shifts
FOR DELETE
USING (true);

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_employee_shifts_updated_at
BEFORE UPDATE ON public.employee_shifts
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Add comment to table
COMMENT ON TABLE public.employee_shifts IS 'Tracks employee work shifts including clock in/out times and locations';
