-- Fix client property primary switching and ownership validation.
--
-- Problems fixed:
-- 1) enforce_client_property_same_owner ran as INVOKER and could fail when RLS hid the
--    parent clients row even though the caller owns the client. It also required the
--    caller to send a matching user_id instead of deriving it from clients.user_id.
-- 2) normalize_client_property_primary re-promoted a row being demoted because the
--    incoming primary row is not visible yet during BEFORE INSERT / concurrent UPDATE.

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

  -- client_properties.user_id is the CRM merchant who owns the client, not the end client.
  NEW.user_id := v_client_user_id;

  IF auth.uid() IS NOT NULL AND auth.uid() IS DISTINCT FROM v_client_user_id THEN
    RAISE EXCEPTION 'not authorized to manage properties for this client';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_client_property_same_owner IS
  'Ensures client_properties rows inherit clients.user_id and belong to the authenticated merchant.';

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

  IF auth.uid() IS NOT NULL AND auth.uid() IS DISTINCT FROM v_property_user_id THEN
    RAISE EXCEPTION 'not authorized to manage contacts for this client property';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_client_property_contact_same_owner IS
  'Ensures client_property_contacts rows inherit client_properties.user_id.';

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
    UPDATE public.client_properties
    SET is_primary = false
    WHERE client_id = NEW.client_id
      AND id IS DISTINCT FROM NEW.id
      AND is_primary = true;
  ELSIF NEW.is_active = true THEN
    -- Another property is being promoted; do not undo that demotion.
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

COMMENT ON FUNCTION public.normalize_client_property_primary IS
  'Keeps exactly one active primary property per client without undoing explicit demotions.';
