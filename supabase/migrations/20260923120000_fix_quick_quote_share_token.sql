-- pgcrypto lives in extensions. The original quick_quotes functions set
-- search_path = public only, so gen_random_bytes(integer) does not exist.
-- That broke generate_quick_quote_share_token AND the BEFORE INSERT trigger
-- that assigns public_share_token — so inserts of empty quotes failed.

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.assign_quick_quote_share_token ()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
BEGIN
  IF NEW.public_share_token IS NULL OR btrim(NEW.public_share_token) = '' THEN
    NEW.public_share_token := encode(extensions.gen_random_bytes(24), 'hex');
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_quick_quote_share_token (p_quick_quote_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, extensions
AS $$
DECLARE
  v_token text;
BEGIN
  LOOP
    v_token := encode(extensions.gen_random_bytes(24), 'hex');
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.quick_quotes WHERE public_share_token = v_token
    );
  END LOOP;

  UPDATE public.quick_quotes
  SET public_share_token = v_token
  WHERE id = p_quick_quote_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quick quote not found';
  END IF;

  RETURN v_token;
END;
$$;

-- Quotes that survived an insert without a token (explicit token, or a failed
-- trigger that was later bypassed) get one now.
UPDATE public.quick_quotes
SET public_share_token = encode(extensions.gen_random_bytes(24), 'hex')
WHERE public_share_token IS NULL OR btrim(public_share_token) = '';

NOTIFY pgrst, 'reload schema';
