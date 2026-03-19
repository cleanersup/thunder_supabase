
-- Crear tabla para rastrear recordatorios enviados
CREATE TABLE IF NOT EXISTS public.appointment_reminders_sent (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  appointment_id UUID NOT NULL REFERENCES public.route_appointments(id) ON DELETE CASCADE,
  reminder_type TEXT NOT NULL CHECK (reminder_type IN ('24h', '1h', 'clock_in', 'clock_out')),
  sent_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(appointment_id, reminder_type)
);

-- Índice para búsquedas rápidas
CREATE INDEX IF NOT EXISTS idx_appointment_reminders_sent_appointment 
ON public.appointment_reminders_sent(appointment_id, reminder_type);

-- Enable RLS
ALTER TABLE public.appointment_reminders_sent ENABLE ROW LEVEL SECURITY;

-- Policy para que los usuarios puedan ver sus propios recordatorios
CREATE POLICY "Users can view their own appointment reminders"
ON public.appointment_reminders_sent
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.route_appointments ra
    JOIN public.routes r ON ra.route_id = r.id
    WHERE ra.id = appointment_id
    AND r.user_id = auth.uid()
  )
);
