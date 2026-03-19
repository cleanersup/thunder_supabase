-- Add timeline fields to walkthroughs table
ALTER TABLE public.walkthroughs
ADD COLUMN completed_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN estimate_sent_at TIMESTAMP WITH TIME ZONE;

-- Create a trigger to automatically set completed_at when status changes to 'Completed'
CREATE OR REPLACE FUNCTION public.set_walkthrough_completed_at()
RETURNS TRIGGER AS $$
BEGIN
  -- Set completed_at when status changes to 'Completed' and it wasn't set before
  IF NEW.status = 'Completed' AND OLD.status != 'Completed' AND NEW.completed_at IS NULL THEN
    NEW.completed_at = now();
  END IF;
  
  -- Set estimate_sent_at when status changes to 'estimate_sent' and it wasn't set before
  IF NEW.status = 'estimate_sent' AND OLD.status != 'estimate_sent' AND NEW.estimate_sent_at IS NULL THEN
    NEW.estimate_sent_at = now();
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Create trigger for walkthroughs
CREATE TRIGGER trigger_set_walkthrough_timestamps
BEFORE UPDATE ON public.walkthroughs
FOR EACH ROW
EXECUTE FUNCTION public.set_walkthrough_completed_at();