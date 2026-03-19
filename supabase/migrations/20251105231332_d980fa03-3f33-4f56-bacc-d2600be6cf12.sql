-- Fix OTP Codes Security - Replace overly permissive policy
DROP POLICY IF EXISTS "System can manage OTP codes" ON otp_codes;
DROP POLICY IF EXISTS "Anyone can create OTP codes" ON otp_codes;

-- Only service role (edge functions) can manage OTP codes
CREATE POLICY "Service role can manage OTP codes"
ON otp_codes
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- Secure the cleanup function - only service role should execute it
REVOKE EXECUTE ON FUNCTION cleanup_expired_otps() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cleanup_expired_otps() TO service_role;