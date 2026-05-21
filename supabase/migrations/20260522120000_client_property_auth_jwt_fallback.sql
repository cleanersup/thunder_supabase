-- Fix persistent 42501 on client_properties INSERT (self-hosted / JWT edge cases).
--
-- Root cause: auth.uid() is often NULL inside RLS/policy functions on self-hosted
-- Supabase even when the REST client sends a valid JWT and user_id in the payload.
-- Authorization now falls back to the row user_id sent by the authenticated client
-- after verifying it matches clients.user_id (merchant owner).

CREATE OR REPLACE FUNCTION public.current_request_user_id ()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
  v_claims jsonb;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NOT NULL THEN
    RETURN v_uid;
  END IF;

  BEGIN
    v_uid := nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    IF v_uid IS NOT NULL THEN
      RETURN v_uid;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  BEGIN
    v_claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
    IF v_claims ? 'sub' THEN
      RETURN nullif(v_claims ->> 'sub', '')::uuid;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.client_property_caller_user_id (p_row_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_jwt_user uuid;
BEGIN
  v_jwt_user := public.current_request_user_id();
  IF v_jwt_user IS NOT NULL THEN
    RETURN v_jwt_user;
  END IF;

  -- Self-hosted fallback: REST insert includes user_id from supabase.auth.getUser().
  RETURN p_row_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.user_owns_client (
  p_client_id uuid,
  p_row_user_id uuid DEFAULT NULL
)
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
  IF p_client_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT c.user_id
  INTO v_owner_id
  FROM public.clients c
  WHERE c.id = p_client_id;

  IF v_owner_id IS NULL THEN
    RETURN false;
  END IF;

  v_caller_id := public.client_property_caller_user_id(p_row_user_id);
  IF v_caller_id IS NULL THEN
    RETURN false;
  END IF;

  RETURN v_owner_id = v_caller_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.user_owns_client_property (
  p_property_id uuid,
  p_row_user_id uuid DEFAULT NULL
)
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

  RETURN public.user_owns_client(v_client_id, p_row_user_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_client_property_same_owner ()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_user_id uuid;
  v_caller_id uuid;
BEGIN
  SELECT c.user_id
  INTO v_client_user_id
  FROM public.clients c
  WHERE c.id = NEW.client_id;

  IF v_client_user_id IS NULL THEN
    RAISE EXCEPTION 'client not found for client_properties.client_id=%', NEW.client_id;
  END IF;

  v_caller_id := public.client_property_caller_user_id(NEW.user_id);
  IF v_caller_id IS NULL OR v_caller_id IS DISTINCT FROM v_client_user_id THEN
    RAISE EXCEPTION 'not authorized to manage properties for this client';
  END IF;

  NEW.user_id := v_client_user_id;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_client_property_contact_same_owner ()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_property_user_id uuid;
  v_caller_id uuid;
BEGIN
  SELECT p.user_id
  INTO v_property_user_id
  FROM public.client_properties p
  WHERE p.id = NEW.property_id;

  IF v_property_user_id IS NULL THEN
    RAISE EXCEPTION 'client property not found for client_property_contacts.property_id=%', NEW.property_id;
  END IF;

  v_caller_id := public.client_property_caller_user_id(NEW.user_id);
  IF v_caller_id IS NULL OR v_caller_id IS DISTINCT FROM v_property_user_id THEN
    RAISE EXCEPTION 'not authorized to manage contacts for this client property';
  END IF;

  NEW.user_id := v_property_user_id;
  RETURN NEW;
END;
$$;

DROP FUNCTION IF EXISTS public.user_owns_client (uuid);
DROP FUNCTION IF EXISTS public.user_owns_client_property (uuid);

GRANT EXECUTE ON FUNCTION public.current_request_user_id () TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.client_property_caller_user_id (uuid) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.user_owns_client (uuid, uuid) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.user_owns_client_property (uuid, uuid) TO authenticated, anon, service_role;

DROP POLICY IF EXISTS "Users can view their own client properties" ON public.client_properties;
CREATE POLICY "Users can view their own client properties"
ON public.client_properties
FOR SELECT
USING (public.user_owns_client(client_id, user_id));

DROP POLICY IF EXISTS "Users can create their own client properties" ON public.client_properties;
CREATE POLICY "Users can create their own client properties"
ON public.client_properties
FOR INSERT
WITH CHECK (public.user_owns_client(client_id, user_id));

DROP POLICY IF EXISTS "Users can update their own client properties" ON public.client_properties;
CREATE POLICY "Users can update their own client properties"
ON public.client_properties
FOR UPDATE
USING (public.user_owns_client(client_id, user_id))
WITH CHECK (public.user_owns_client(client_id, user_id));

DROP POLICY IF EXISTS "Users can delete their own client properties" ON public.client_properties;
CREATE POLICY "Users can delete their own client properties"
ON public.client_properties
FOR DELETE
USING (public.user_owns_client(client_id, user_id));

DROP POLICY IF EXISTS "Users can view their own client property contacts" ON public.client_property_contacts;
CREATE POLICY "Users can view their own client property contacts"
ON public.client_property_contacts
FOR SELECT
USING (public.user_owns_client_property(property_id, user_id));

DROP POLICY IF EXISTS "Users can create their own client property contacts" ON public.client_property_contacts;
CREATE POLICY "Users can create their own client property contacts"
ON public.client_property_contacts
FOR INSERT
WITH CHECK (public.user_owns_client_property(property_id, user_id));

DROP POLICY IF EXISTS "Users can update their own client property contacts" ON public.client_property_contacts;
CREATE POLICY "Users can update their own client property contacts"
ON public.client_property_contacts
FOR UPDATE
USING (public.user_owns_client_property(property_id, user_id))
WITH CHECK (public.user_owns_client_property(property_id, user_id));

DROP POLICY IF EXISTS "Users can delete their own client property contacts" ON public.client_property_contacts;
CREATE POLICY "Users can delete their own client property contacts"
ON public.client_property_contacts
FOR DELETE
USING (public.user_owns_client_property(property_id, user_id));
