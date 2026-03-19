-- Fix generate_estimate_share_token function to actually save tokens to database
-- The old function (from create_generate_estimate_share_token.sql) only returned a token
-- without saving it to the public_share_token column, causing public estimate links to fail.
-- This migration ensures the function saves the token to the database.

DROP FUNCTION IF EXISTS public.generate_estimate_share_token(UUID);

CREATE OR REPLACE FUNCTION public.generate_estimate_share_token(estimate_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  token TEXT;
  token_exists BOOLEAN;
BEGIN
  -- Generate unique token using pgcrypto extension from extensions schema
  LOOP
    token := encode(extensions.gen_random_bytes(16), 'base64');
    token := replace(replace(replace(token, '/', '_'), '+', '-'), '=', '');
    
    SELECT EXISTS(SELECT 1 FROM estimates WHERE public_share_token = token) INTO token_exists;
    EXIT WHEN NOT token_exists;
  END LOOP;
  
  -- Update estimate with token (THIS WAS MISSING IN THE OLD FUNCTION)
  UPDATE estimates 
  SET public_share_token = token 
  WHERE id = estimate_id;
  
  RETURN token;
END;
$$;
