-- Create walkthroughs table
CREATE TABLE public.walkthroughs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  client_id UUID,
  lead_id UUID,
  walkthrough_type TEXT NOT NULL CHECK (walkthrough_type IN ('client', 'lead')),
  service_type TEXT NOT NULL,
  scheduled_date DATE NOT NULL,
  scheduled_time TIME NOT NULL,
  assigned_employees JSONB DEFAULT '[]'::jsonb,
  duration INTEGER,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'Scheduled' CHECK (status IN ('Scheduled', 'Pending', 'Completed', 'Cancelled')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.walkthroughs ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY "Users can create their own walkthroughs"
ON public.walkthroughs
FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view their own walkthroughs"
ON public.walkthroughs
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own walkthroughs"
ON public.walkthroughs
FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own walkthroughs"
ON public.walkthroughs
FOR DELETE
USING (auth.uid() = user_id);

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_walkthroughs_updated_at
BEFORE UPDATE ON public.walkthroughs
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();