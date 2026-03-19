-- Migration: Auto-generate public_share_token for estimates
-- This ensures every estimate has a public_share_token for sharing
-- Fixes the issue where edited estimates couldn't be viewed via public links

-- Create trigger function to auto-generate public_share_token
CREATE OR REPLACE FUNCTION public.auto_generate_estimate_share_token()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  new_token TEXT;
  token_exists BOOLEAN;
BEGIN
  -- Only generate token if it's NULL or empty
  IF NEW.public_share_token IS NULL OR NEW.public_share_token = '' THEN
    -- Generate unique token using pgcrypto extension
    LOOP
      new_token := encode(extensions.gen_random_bytes(16), 'base64');
      new_token := replace(replace(replace(new_token, '/', '_'), '+', '-'), '=', '');
      
      SELECT EXISTS(SELECT 1 FROM estimates WHERE public_share_token = new_token) INTO token_exists;
      EXIT WHEN NOT token_exists;
    END LOOP;
    
    NEW.public_share_token := new_token;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Drop existing trigger if it exists
DROP TRIGGER IF EXISTS trigger_auto_generate_estimate_share_token ON estimates;

-- Create trigger that runs BEFORE INSERT OR UPDATE
CREATE TRIGGER trigger_auto_generate_estimate_share_token
  BEFORE INSERT OR UPDATE ON estimates
  FOR EACH ROW
  EXECUTE FUNCTION auto_generate_estimate_share_token();

-- Backfill existing estimates that don't have a token
UPDATE estimates 
SET public_share_token = (
  SELECT token FROM (
    SELECT 
      id,
      encode(extensions.gen_random_bytes(16), 'base64') as token
    FROM estimates
  ) subquery
  WHERE subquery.id = estimates.id
)
WHERE public_share_token IS NULL OR public_share_token = '';

COMMENT ON FUNCTION auto_generate_estimate_share_token() IS 
'Automatically generates a unique public_share_token for estimates if one doesn''t exist. This ensures all estimates can be shared via public links.';

COMMENT ON TRIGGER trigger_auto_generate_estimate_share_token ON estimates IS
'Automatically generates public_share_token before INSERT or UPDATE if the token is NULL or empty.';
