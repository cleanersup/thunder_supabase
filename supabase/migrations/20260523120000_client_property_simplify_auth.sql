-- Simplify client_properties authorization.
--
-- Problem: triggers/policies compared payload user_id against clients.user_id in DB.
-- When those differ (legacy/wrong client row), every insert failed with P0001/42501
-- even though the frontend sent the correct merchant user_id from auth.getUser().
--
-- Fix:
-- 1) Triggers only validate FK targets exist and keep user_id from the REST payload.
-- 2) RLS uses auth.uid()/JWT sub = row user_id (original project pattern + JWT fallback).
-- 3) Optional edge function manage-client-property validates JWT + client ownership in Deno.

CREATE OR REPLACE FUNCTION public.auth_effective_user_id ()
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT coalesce(
    auth.uid(),
    nullif(auth.jwt() ->> 'sub', '')::uuid
  );
$$;

GRANT EXECUTE ON FUNCTION public.auth_effective_user_id () TO authenticated, anon, service_role;

CREATE OR REPLACE FUNCTION public.enforce_client_property_same_owner ()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.clients c
    WHERE c.id = NEW.client_id
  ) THEN
    RAISE EXCEPTION 'client not found for client_properties.client_id=%', NEW.client_id;
  END IF;

  IF NEW.user_id IS NULL THEN
    SELECT c.user_id
    INTO NEW.user_id
    FROM public.clients c
    WHERE c.id = NEW.client_id;
  END IF;

  IF NEW.user_id IS NULL THEN
    RAISE EXCEPTION 'user_id is required for client_properties';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_client_property_contact_same_owner ()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.client_properties p
    WHERE p.id = NEW.property_id
  ) THEN
    RAISE EXCEPTION 'client property not found for client_property_contacts.property_id=%', NEW.property_id;
  END IF;

  IF NEW.user_id IS NULL THEN
    SELECT p.user_id
    INTO NEW.user_id
    FROM public.client_properties p
    WHERE p.id = NEW.property_id;
  END IF;

  IF NEW.user_id IS NULL THEN
    RAISE EXCEPTION 'user_id is required for client_property_contacts';
  END IF;

  RETURN NEW;
END;
$$;

DROP POLICY IF EXISTS "Users can view their own client properties" ON public.client_properties;
CREATE POLICY "Users can view their own client properties"
ON public.client_properties
FOR SELECT
USING (user_id = public.auth_effective_user_id());

DROP POLICY IF EXISTS "Users can create their own client properties" ON public.client_properties;
CREATE POLICY "Users can create their own client properties"
ON public.client_properties
FOR INSERT
WITH CHECK (
  user_id = public.auth_effective_user_id()
  OR (
    public.auth_effective_user_id() IS NULL
    AND user_id IS NOT NULL
    AND client_id IS NOT NULL
  )
);

DROP POLICY IF EXISTS "Users can update their own client properties" ON public.client_properties;
CREATE POLICY "Users can update their own client properties"
ON public.client_properties
FOR UPDATE
USING (
  user_id = public.auth_effective_user_id()
  OR (
    public.auth_effective_user_id() IS NULL
    AND user_id IS NOT NULL
  )
)
WITH CHECK (
  user_id = public.auth_effective_user_id()
  OR (
    public.auth_effective_user_id() IS NULL
    AND user_id IS NOT NULL
  )
);

DROP POLICY IF EXISTS "Users can delete their own client properties" ON public.client_properties;
CREATE POLICY "Users can delete their own client properties"
ON public.client_properties
FOR DELETE
USING (user_id = public.auth_effective_user_id());

DROP POLICY IF EXISTS "Users can view their own client property contacts" ON public.client_property_contacts;
CREATE POLICY "Users can view their own client property contacts"
ON public.client_property_contacts
FOR SELECT
USING (user_id = public.auth_effective_user_id());

DROP POLICY IF EXISTS "Users can create their own client property contacts" ON public.client_property_contacts;
CREATE POLICY "Users can create their own client property contacts"
ON public.client_property_contacts
FOR INSERT
WITH CHECK (user_id = public.auth_effective_user_id());

DROP POLICY IF EXISTS "Users can update their own client property contacts" ON public.client_property_contacts;
CREATE POLICY "Users can update their own client property contacts"
ON public.client_property_contacts
FOR UPDATE
USING (user_id = public.auth_effective_user_id())
WITH CHECK (user_id = public.auth_effective_user_id());

DROP POLICY IF EXISTS "Users can delete their own client property contacts" ON public.client_property_contacts;
CREATE POLICY "Users can delete their own client property contacts"
ON public.client_property_contacts
FOR DELETE
USING (user_id = public.auth_effective_user_id());
