-- Enable pgcrypto extension for gen_random_bytes
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Drop and recreate the function with proper extension
DROP FUNCTION IF EXISTS public.generate_estimate_share_token(UUID);

CREATE OR REPLACE FUNCTION public.generate_estimate_share_token(estimate_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  token TEXT;
  token_exists BOOLEAN;
BEGIN
  -- Generate unique token using pgcrypto extension
  LOOP
    token := encode(gen_random_bytes(16), 'base64');
    token := replace(replace(replace(token, '/', '_'), '+', '-'), '=', '');
    
    SELECT EXISTS(SELECT 1 FROM estimates WHERE public_share_token = token) INTO token_exists;
    EXIT WHEN NOT token_exists;
  END LOOP;
  
  -- Update estimate with token
  UPDATE estimates 
  SET public_share_token = token 
  WHERE id = estimate_id;
  
  RETURN token;
END;
$$;