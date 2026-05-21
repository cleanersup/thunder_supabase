-- Fix client property authorization false rejections.
--
-- The previous fix added an auth.uid() check inside a SECURITY DEFINER trigger.
-- That check could reject valid merchants even when they own the CRM client.
-- Authorization now relies on RLS tied to clients.user_id (the merchant owner),
-- while triggers only normalize ownership columns.

CREATE OR REPLACE FUNCTION public.current_request_user_id ()
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT coalesce(
    auth.uid(),
    nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  );
$$;

COMMENT ON FUNCTION public.current_request_user_id IS
  'Resolved authenticated user id from auth.uid() or JWT sub claim.';

CREATE OR REPLACE FUNCTION public.user_owns_client (p_client_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.clients c
    WHERE c.id = p_client_id
      AND c.user_id = public.current_request_user_id()
  );
$$;

COMMENT ON FUNCTION public.user_owns_client IS
  'True when the current request user owns the CRM client row.';

CREATE OR REPLACE FUNCTION public.user_owns_client_property (p_property_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.client_properties p
    JOIN public.clients c ON c.id = p.client_id
    WHERE p.id = p_property_id
      AND c.user_id = public.current_request_user_id()
  );
$$;

COMMENT ON FUNCTION public.user_owns_client_property IS
  'True when the current request user owns the parent client of a property.';

CREATE OR REPLACE FUNCTION public.enforce_client_property_same_owner ()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_user_id uuid;
BEGIN
  SELECT c.user_id
  INTO v_client_user_id
  FROM public.clients c
  WHERE c.id = NEW.client_id;

  IF v_client_user_id IS NULL THEN
    RAISE EXCEPTION 'client not found for client_properties.client_id=%', NEW.client_id;
  END IF;

  -- Always store the merchant owner from the parent CRM client row.
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
BEGIN
  SELECT p.user_id
  INTO v_property_user_id
  FROM public.client_properties p
  WHERE p.id = NEW.property_id;

  IF v_property_user_id IS NULL THEN
    RAISE EXCEPTION 'client property not found for client_property_contacts.property_id=%', NEW.property_id;
  END IF;

  NEW.user_id := v_property_user_id;

  RETURN NEW;
END;
$$;

-- client_properties: authorize via parent client ownership, not payload user_id.
DROP POLICY IF EXISTS "Users can view their own client properties" ON public.client_properties;
CREATE POLICY "Users can view their own client properties"
ON public.client_properties
FOR SELECT
TO authenticated
USING (public.user_owns_client(client_id));

DROP POLICY IF EXISTS "Users can create their own client properties" ON public.client_properties;
CREATE POLICY "Users can create their own client properties"
ON public.client_properties
FOR INSERT
TO authenticated
WITH CHECK (public.user_owns_client(client_id));

DROP POLICY IF EXISTS "Users can update their own client properties" ON public.client_properties;
CREATE POLICY "Users can update their own client properties"
ON public.client_properties
FOR UPDATE
TO authenticated
USING (public.user_owns_client(client_id))
WITH CHECK (public.user_owns_client(client_id));

DROP POLICY IF EXISTS "Users can delete their own client properties" ON public.client_properties;
CREATE POLICY "Users can delete their own client properties"
ON public.client_properties
FOR DELETE
TO authenticated
USING (public.user_owns_client(client_id));

-- client_property_contacts: authorize via parent property -> client ownership.
DROP POLICY IF EXISTS "Users can view their own client property contacts" ON public.client_property_contacts;
CREATE POLICY "Users can view their own client property contacts"
ON public.client_property_contacts
FOR SELECT
TO authenticated
USING (public.user_owns_client_property(property_id));

DROP POLICY IF EXISTS "Users can create their own client property contacts" ON public.client_property_contacts;
CREATE POLICY "Users can create their own client property contacts"
ON public.client_property_contacts
FOR INSERT
TO authenticated
WITH CHECK (public.user_owns_client_property(property_id));

DROP POLICY IF EXISTS "Users can update their own client property contacts" ON public.client_property_contacts;
CREATE POLICY "Users can update their own client property contacts"
ON public.client_property_contacts
FOR UPDATE
TO authenticated
USING (public.user_owns_client_property(property_id))
WITH CHECK (public.user_owns_client_property(property_id));

DROP POLICY IF EXISTS "Users can delete their own client property contacts" ON public.client_property_contacts;
CREATE POLICY "Users can delete their own client property contacts"
ON public.client_property_contacts
FOR DELETE
TO authenticated
USING (public.user_owns_client_property(property_id));
