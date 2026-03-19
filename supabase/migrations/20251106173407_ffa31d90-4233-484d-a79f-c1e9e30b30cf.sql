-- Create table to track walkthrough reminder emails sent
CREATE TABLE IF NOT EXISTS public.walkthrough_reminders_sent (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  walkthrough_id UUID NOT NULL,
  reminder_type TEXT NOT NULL CHECK (reminder_type IN ('confirmation', '1h')),
  sent_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.walkthrough_reminders_sent ENABLE ROW LEVEL SECURITY;

-- Create policy for viewing reminders (users can view reminders for their own walkthroughs)
CREATE POLICY "Users can view reminders for their walkthroughs"
ON public.walkthrough_reminders_sent
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.walkthroughs w
    WHERE w.id = walkthrough_reminders_sent.walkthrough_id
    AND w.user_id = auth.uid()
  )
);

-- Service role can manage all reminders
CREATE POLICY "Service role can manage walkthrough reminders"
ON public.walkthrough_reminders_sent
FOR ALL
USING (true)
WITH CHECK (true);

-- Create index for faster lookups
CREATE INDEX idx_walkthrough_reminders_walkthrough_id ON public.walkthrough_reminders_sent(walkthrough_id);
CREATE INDEX idx_walkthrough_reminders_type ON public.walkthrough_reminders_sent(reminder_type);

-- Enable pg_cron extension if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Enable pg_net extension for HTTP requests
CREATE EXTENSION IF NOT EXISTS pg_net;