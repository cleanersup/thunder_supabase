-- Create commercial_walkthrough_data table
CREATE TABLE public.commercial_walkthrough_data (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  walkthrough_id UUID NOT NULL,
  user_id UUID NOT NULL,
  property_type TEXT,
  property_size TEXT,
  service_type TEXT,
  service_schedule TEXT,
  grease_level TEXT,
  restaurant_condition TEXT,
  extra_services JSONB DEFAULT '[]'::jsonb,
  recurring_frequency TEXT,
  selected_week_days JSONB DEFAULT '[]'::jsonb,
  employee_count TEXT,
  hourly_rate TEXT,
  cleaning_duration TEXT,
  start_time TEXT,
  notes TEXT,
  photos JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.commercial_walkthrough_data ENABLE ROW LEVEL SECURITY;

-- Create policies for commercial walkthrough data
CREATE POLICY "Users can view their own commercial walkthrough data" 
ON public.commercial_walkthrough_data 
FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own commercial walkthrough data" 
ON public.commercial_walkthrough_data 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own commercial walkthrough data" 
ON public.commercial_walkthrough_data 
FOR UPDATE 
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own commercial walkthrough data" 
ON public.commercial_walkthrough_data 
FOR DELETE 
USING (auth.uid() = user_id);

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_commercial_walkthrough_data_updated_at
BEFORE UPDATE ON public.commercial_walkthrough_data
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();