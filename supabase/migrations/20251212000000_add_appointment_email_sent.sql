-- Add email_sent column to route_appointments table to track if confirmation email has been sent
-- This prevents duplicate emails and enables scheduled email sending

ALTER TABLE public.route_appointments 
ADD COLUMN IF NOT EXISTS email_sent boolean NOT NULL DEFAULT false;

-- Create index for efficient querying of appointments that need emails
CREATE INDEX IF NOT EXISTS idx_route_appointments_email_sent_date 
ON public.route_appointments(scheduled_date, email_sent, status) 
WHERE email_sent = false AND status = 'scheduled';

-- Create trigger to reset email_sent when appointment date changes
CREATE OR REPLACE FUNCTION reset_appointment_email_sent()
RETURNS TRIGGER AS $$
BEGIN
  -- Reset email_sent when scheduled_date changes
  IF OLD.scheduled_date IS DISTINCT FROM NEW.scheduled_date THEN
    NEW.email_sent = false;
  END IF;
  
  -- Reset email_sent when status changes from scheduled to something else and back
  IF OLD.status = 'scheduled' AND NEW.status != 'scheduled' THEN
    NEW.email_sent = false;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for automatic email_sent reset
DROP TRIGGER IF EXISTS reset_appointment_email_sent_trigger ON public.route_appointments;
CREATE TRIGGER reset_appointment_email_sent_trigger
  BEFORE UPDATE ON public.route_appointments
  FOR EACH ROW
  EXECUTE FUNCTION reset_appointment_email_sent();
