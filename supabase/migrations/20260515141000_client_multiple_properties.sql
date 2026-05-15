-- Multi-property support for clients (backward-compatible rollout).
-- Keeps legacy clients.service_* fields working while adding normalized tables.

-- 1) New table: client_properties
CREATE TABLE IF NOT EXISTS public.client_properties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  title text,
  street text NOT NULL,
  apt_suite text,
  city text NOT NULL,
  state text NOT NULL,
  zip_code text NOT NULL,
  is_primary boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_properties_user_id
  ON public.client_properties(user_id);

CREATE INDEX IF NOT EXISTS idx_client_properties_client_id
  ON public.client_properties(client_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_client_properties_one_primary_per_client
  ON public.client_properties(client_id)
  WHERE is_primary = true AND is_active = true;

COMMENT ON TABLE public.client_properties IS
  'Service properties/addresses for a CRM client. Supports multiple properties per client.';

COMMENT ON COLUMN public.client_properties.is_primary IS
  'Marks the primary service property for a client. Exactly one active primary per client.';

-- 2) New table: contacts per property
CREATE TABLE IF NOT EXISTS public.client_property_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  property_id uuid NOT NULL REFERENCES public.client_properties(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  phone text,
  email text,
  role text,
  is_primary_contact boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_property_contacts_property_id
  ON public.client_property_contacts(property_id);

CREATE INDEX IF NOT EXISTS idx_client_property_contacts_user_id
  ON public.client_property_contacts(user_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_client_property_contacts_primary_per_property
  ON public.client_property_contacts(property_id)
  WHERE is_primary_contact = true;

COMMENT ON TABLE public.client_property_contacts IS
  'Contact people available at a specific client property.';

-- 3) RLS
ALTER TABLE public.client_properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_property_contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own client properties" ON public.client_properties;
CREATE POLICY "Users can view their own client properties"
ON public.client_properties
FOR SELECT
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can create their own client properties" ON public.client_properties;
CREATE POLICY "Users can create their own client properties"
ON public.client_properties
FOR INSERT
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own client properties" ON public.client_properties;
CREATE POLICY "Users can update their own client properties"
ON public.client_properties
FOR UPDATE
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own client properties" ON public.client_properties;
CREATE POLICY "Users can delete their own client properties"
ON public.client_properties
FOR DELETE
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view their own client property contacts" ON public.client_property_contacts;
CREATE POLICY "Users can view their own client property contacts"
ON public.client_property_contacts
FOR SELECT
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can create their own client property contacts" ON public.client_property_contacts;
CREATE POLICY "Users can create their own client property contacts"
ON public.client_property_contacts
FOR INSERT
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own client property contacts" ON public.client_property_contacts;
CREATE POLICY "Users can update their own client property contacts"
ON public.client_property_contacts
FOR UPDATE
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own client property contacts" ON public.client_property_contacts;
CREATE POLICY "Users can delete their own client property contacts"
ON public.client_property_contacts
FOR DELETE
USING (auth.uid() = user_id);

-- 4) Timestamp triggers
DROP TRIGGER IF EXISTS update_client_properties_updated_at ON public.client_properties;
CREATE TRIGGER update_client_properties_updated_at
  BEFORE UPDATE ON public.client_properties
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_client_property_contacts_updated_at ON public.client_property_contacts;
CREATE TRIGGER update_client_property_contacts_updated_at
  BEFORE UPDATE ON public.client_property_contacts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- 5) Owner consistency guards
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
      AND c.user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'client_properties.client_id must belong to the same user_id';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_enforce_client_property_same_owner ON public.client_properties;
CREATE TRIGGER tr_enforce_client_property_same_owner
  BEFORE INSERT OR UPDATE OF user_id, client_id ON public.client_properties
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_client_property_same_owner();

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
      AND p.user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'client_property_contacts.property_id must belong to the same user_id';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_enforce_client_property_contact_same_owner ON public.client_property_contacts;
CREATE TRIGGER tr_enforce_client_property_contact_same_owner
  BEFORE INSERT OR UPDATE OF user_id, property_id ON public.client_property_contacts
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_client_property_contact_same_owner();

-- 6) Ensure one primary property behavior
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

DROP TRIGGER IF EXISTS tr_normalize_client_property_primary ON public.client_properties;
CREATE TRIGGER tr_normalize_client_property_primary
  BEFORE INSERT OR UPDATE OF is_primary, is_active, client_id ON public.client_properties
  FOR EACH ROW
  EXECUTE FUNCTION public.normalize_client_property_primary();

-- 7) Sync primary property -> legacy clients.service_* (backward compatibility)
CREATE OR REPLACE FUNCTION public.sync_primary_property_to_client_service_address ()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_client_id uuid;
  v_user_id uuid;
  v_primary record;
BEGIN
  -- Avoid ping-pong recursion with clients -> properties sync trigger.
  IF pg_trigger_depth() > 1 THEN
    RETURN NULL;
  END IF;

  v_client_id := COALESCE(NEW.client_id, OLD.client_id);
  v_user_id := COALESCE(NEW.user_id, OLD.user_id);

  -- If the primary row was deleted, promote another active property.
  IF TG_OP = 'DELETE' AND OLD.is_primary = true THEN
    UPDATE public.client_properties p
    SET is_primary = true
    WHERE p.id = (
      SELECT p2.id
      FROM public.client_properties p2
      WHERE p2.client_id = OLD.client_id
        AND p2.is_active = true
      ORDER BY p2.created_at ASC
      LIMIT 1
    );
  END IF;

  SELECT
    p.street,
    p.apt_suite,
    p.city,
    p.state,
    p.zip_code
  INTO v_primary
  FROM public.client_properties p
  WHERE p.client_id = v_client_id
    AND p.is_primary = true
    AND p.is_active = true
  LIMIT 1;

  IF FOUND THEN
    UPDATE public.clients c
    SET
      service_street = v_primary.street,
      service_apt = v_primary.apt_suite,
      service_city = v_primary.city,
      service_state = v_primary.state,
      service_zip = v_primary.zip_code
    WHERE c.id = v_client_id
      AND c.user_id = v_user_id
      AND (
        c.service_street IS DISTINCT FROM v_primary.street OR
        c.service_apt IS DISTINCT FROM v_primary.apt_suite OR
        c.service_city IS DISTINCT FROM v_primary.city OR
        c.service_state IS DISTINCT FROM v_primary.state OR
        c.service_zip IS DISTINCT FROM v_primary.zip_code
      );
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS tr_sync_primary_property_to_client_service_address ON public.client_properties;
CREATE TRIGGER tr_sync_primary_property_to_client_service_address
  AFTER INSERT OR UPDATE OF street, apt_suite, city, state, zip_code, is_primary, is_active OR DELETE
  ON public.client_properties
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_primary_property_to_client_service_address();

-- 8) Sync legacy clients.service_* -> primary property (for old flows/new client inserts)
CREATE OR REPLACE FUNCTION public.sync_client_service_address_to_primary_property ()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_primary_property_id uuid;
BEGIN
  -- Avoid ping-pong recursion with properties -> clients sync trigger.
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  SELECT p.id
  INTO v_primary_property_id
  FROM public.client_properties p
  WHERE p.client_id = NEW.id
    AND p.is_primary = true
    AND p.is_active = true
  LIMIT 1;

  IF v_primary_property_id IS NULL THEN
    INSERT INTO public.client_properties (
      user_id,
      client_id,
      title,
      street,
      apt_suite,
      city,
      state,
      zip_code,
      is_primary,
      is_active
    ) VALUES (
      NEW.user_id,
      NEW.id,
      'Primary property',
      NEW.service_street,
      NEW.service_apt,
      NEW.service_city,
      NEW.service_state,
      NEW.service_zip,
      true,
      true
    );
  ELSE
    UPDATE public.client_properties p
    SET
      street = NEW.service_street,
      apt_suite = NEW.service_apt,
      city = NEW.service_city,
      state = NEW.service_state,
      zip_code = NEW.service_zip
    WHERE p.id = v_primary_property_id
      AND (
        p.street IS DISTINCT FROM NEW.service_street OR
        p.apt_suite IS DISTINCT FROM NEW.service_apt OR
        p.city IS DISTINCT FROM NEW.service_city OR
        p.state IS DISTINCT FROM NEW.service_state OR
        p.zip_code IS DISTINCT FROM NEW.service_zip
      );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_sync_client_service_address_to_primary_property ON public.clients;
CREATE TRIGGER tr_sync_client_service_address_to_primary_property
  AFTER INSERT OR UPDATE OF service_street, service_apt, service_city, service_state, service_zip
  ON public.clients
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_client_service_address_to_primary_property();

-- 9) Backfill existing active users without changing current data semantics
INSERT INTO public.client_properties (
  user_id,
  client_id,
  title,
  street,
  apt_suite,
  city,
  state,
  zip_code,
  is_primary,
  is_active
)
SELECT
  c.user_id,
  c.id,
  'Primary property',
  c.service_street,
  c.service_apt,
  c.service_city,
  c.service_state,
  c.service_zip,
  true,
  true
FROM public.clients c
WHERE NOT EXISTS (
  SELECT 1
  FROM public.client_properties p
  WHERE p.client_id = c.id
);
