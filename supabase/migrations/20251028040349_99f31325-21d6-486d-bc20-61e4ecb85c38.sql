-- Create route_appointments table to store scheduled appointments for routes
CREATE TABLE public.route_appointments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  route_id UUID NOT NULL REFERENCES public.routes(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  scheduled_date DATE NOT NULL,
  scheduled_time TIME WITHOUT TIME ZONE,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.route_appointments ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for route_appointments
CREATE POLICY "Users can view their own appointments"
  ON public.route_appointments
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own appointments"
  ON public.route_appointments
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own appointments"
  ON public.route_appointments
  FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own appointments"
  ON public.route_appointments
  FOR DELETE
  USING (auth.uid() = user_id);

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_route_appointments_updated_at
  BEFORE UPDATE ON public.route_appointments
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();