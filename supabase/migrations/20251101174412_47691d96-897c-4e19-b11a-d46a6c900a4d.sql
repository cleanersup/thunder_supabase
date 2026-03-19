-- Create table to store temporary OTP codes
CREATE TABLE public.otp_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number TEXT NOT NULL,
  otp_code TEXT NOT NULL,
  employee_id UUID REFERENCES public.employees(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  verified BOOLEAN DEFAULT false,
  attempts INTEGER DEFAULT 0
);

-- Enable RLS
ALTER TABLE public.otp_codes ENABLE ROW LEVEL SECURITY;

-- Create index for faster lookups
CREATE INDEX idx_otp_phone ON public.otp_codes(phone_number);
CREATE INDEX idx_otp_expires ON public.otp_codes(expires_at);

-- Policy to allow anyone to create OTP codes (for sending)
CREATE POLICY "Anyone can create OTP codes"
ON public.otp_codes
FOR INSERT
TO anon, authenticated
WITH CHECK (true);

-- Policy to allow reading OTP codes (for verification)
CREATE POLICY "Anyone can read OTP codes"
ON public.otp_codes
FOR SELECT
TO anon, authenticated
USING (true);

-- Policy to allow updating OTP codes (for marking as verified)
CREATE POLICY "Anyone can update OTP codes"
ON public.otp_codes
FOR UPDATE
TO anon, authenticated
USING (true);

-- Function to cleanup expired OTP codes (run periodically)
CREATE OR REPLACE FUNCTION public.cleanup_expired_otps()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.otp_codes
  WHERE expires_at < now();
END;
$$;