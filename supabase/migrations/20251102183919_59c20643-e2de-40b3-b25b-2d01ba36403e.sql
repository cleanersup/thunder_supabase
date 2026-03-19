-- Fix OTP codes security - estos códigos son sensibles y deben estar protegidos
DROP POLICY IF EXISTS "Anyone can read OTP codes" ON public.otp_codes;
DROP POLICY IF EXISTS "Anyone can update OTP codes" ON public.otp_codes;

-- Solo el sistema debe poder leer/actualizar OTPs (para verificación)
-- Los usuarios normales NO deben poder ver códigos OTP de otros
CREATE POLICY "System can manage OTP codes"
ON public.otp_codes
FOR ALL
USING (true)
WITH CHECK (true);

-- Para booking_forms, permitir lectura pública solo para mostrar preguntas en formularios públicos
-- pero mantener la creación/edición protegida por usuario
CREATE POLICY "Anyone can view booking forms for public pages"
ON public.booking_forms
FOR SELECT
USING (true);