-- Add public share token to estimates table
ALTER TABLE public.estimates 
ADD COLUMN IF NOT EXISTS public_share_token TEXT UNIQUE;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_estimates_public_share_token 
ON public.estimates(public_share_token);

-- Create RLS policy for public access with valid token
CREATE POLICY "Anyone can view estimates with valid share token"
ON public.estimates
FOR SELECT
USING (public_share_token IS NOT NULL);

-- Function to generate unique share token
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
  -- Generate unique token
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