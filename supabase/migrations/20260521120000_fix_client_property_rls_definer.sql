-- Fix 42501 RLS violations on client_properties INSERT/UPDATE.
--
-- user_owns_client() previously ran as INVOKER; the clients subquery could fail
-- under RLS even for the legitimate owner. Ownership helpers now run as
-- SECURITY DEFINER (read owner id directly, compare to JWT caller).
-- Primary demotion during INSERT/UPDATE also runs elevated so it is not blocked.

CREATE OR REPLACE FUNCTION public.current_request_user_id ()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    auth.uid(),
    nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  );
$$;

CREATE OR REPLACE FUNCTION public.user_owns_client (p_client_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner_id uuid;
  v_caller_id uuid;
BEGIN
  v_caller_id := public.current_request_user_id();
  IF v_caller_id IS NULL OR p_client_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT c.user_id
  INTO v_owner_id
  FROM public.clients c
  WHERE c.id = p_client_id;

  IF v_owner_id IS NULL THEN
    RETURN false;
  END IF;

  RETURN v_owner_id = v_caller_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.user_owns_client_property (p_property_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_id uuid;
BEGIN
  IF p_property_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT p.client_id
  INTO v_client_id
  FROM public.client_properties p
  WHERE p.id = p_property_id;

  IF v_client_id IS NULL THEN
    RETURN false;
  END IF;

  RETURN public.user_owns_client(v_client_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.clear_other_client_property_primaries (
  p_client_id uuid,
  p_keep_id uuid
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.client_properties
  SET is_primary = false
  WHERE client_id = p_client_id
    AND id IS DISTINCT FROM p_keep_id
    AND is_primary = true;
$$;

CREATE OR REPLACE FUNCTION public.normalize_client_property_primary ()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_has_other_primary boolean;
BEGIN
  IF NEW.is_active = false THEN
    NEW.is_primary := false;
  END IF;

  IF NEW.is_primary = true THEN
    PERFORM public.clear_other_client_property_primaries(NEW.client_id, NEW.id);
  ELSIF NEW.is_active = true THEN
    IF TG_OP = 'UPDATE'
      AND OLD.is_primary = true
      AND NEW.is_primary = false THEN
      RETURN NEW;
    END IF;

    SELECT EXISTS (
      SELECT 1
      FROM public.client_properties p
      WHERE p.client_id = NEW.client_id
        AND p.id IS DISTINCT FROM NEW.id
        AND p.is_primary = true
        AND p.is_active = true
    ) INTO v_has_other_primary;

    IF NOT v_has_other_primary THEN
      NEW.is_primary := true;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

GRANT EXECUTE ON FUNCTION public.current_request_user_id () TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.user_owns_client (uuid) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.user_owns_client_property (uuid) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.clear_other_client_property_primaries (uuid, uuid) TO authenticated, anon, service_role;

-- Recreate policies without TO authenticated (match original project pattern).
DROP POLICY IF EXISTS "Users can view their own client properties" ON public.client_properties;
CREATE POLICY "Users can view their own client properties"
ON public.client_properties
FOR SELECT
USING (public.user_owns_client(client_id));

DROP POLICY IF EXISTS "Users can create their own client properties" ON public.client_properties;
CREATE POLICY "Users can create their own client properties"
ON public.client_properties
FOR INSERT
WITH CHECK (public.user_owns_client(client_id));

DROP POLICY IF EXISTS "Users can update their own client properties" ON public.client_properties;
CREATE POLICY "Users can update their own client properties"
ON public.client_properties
FOR UPDATE
USING (public.user_owns_client(client_id))
WITH CHECK (public.user_owns_client(client_id));

DROP POLICY IF EXISTS "Users can delete their own client properties" ON public.client_properties;
CREATE POLICY "Users can delete their own client properties"
ON public.client_properties
FOR DELETE
USING (public.user_owns_client(client_id));

DROP POLICY IF EXISTS "Users can view their own client property contacts" ON public.client_property_contacts;
CREATE POLICY "Users can view their own client property contacts"
ON public.client_property_contacts
FOR SELECT
USING (public.user_owns_client_property(property_id));

DROP POLICY IF EXISTS "Users can create their own client property contacts" ON public.client_property_contacts;
CREATE POLICY "Users can create their own client property contacts"
ON public.client_property_contacts
FOR INSERT
WITH CHECK (public.user_owns_client_property(property_id));

DROP POLICY IF EXISTS "Users can update their own client property contacts" ON public.client_property_contacts;
CREATE POLICY "Users can update their own client property contacts"
ON public.client_property_contacts
FOR UPDATE
USING (public.user_owns_client_property(property_id))
WITH CHECK (public.user_owns_client_property(property_id));

DROP POLICY IF EXISTS "Users can delete their own client property contacts" ON public.client_property_contacts;
CREATE POLICY "Users can delete their own client property contacts"
ON public.client_property_contacts
FOR DELETE
USING (public.user_owns_client_property(property_id));
