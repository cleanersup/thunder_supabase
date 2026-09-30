-- Default every address/country field to the country chosen at registration
-- (profiles.company_country). If the caller sends a country, that value is kept
-- (normalized to ISO alpha-2). If they omit it, get_user_country() fills it in.

-- ─── 1) Canonical ISO names ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.country_codes (
  code text PRIMARY KEY,
  name text NOT NULL
);

INSERT INTO public.country_codes (code, name) VALUES
  ('us', 'United States'),
  ('ca', 'Canada'),
  ('mx', 'Mexico'),
  ('gb', 'United Kingdom'),
  ('au', 'Australia'),
  ('de', 'Germany'),
  ('fr', 'France'),
  ('es', 'Spain'),
  ('it', 'Italy'),
  ('nl', 'Netherlands'),
  ('br', 'Brazil'),
  ('ar', 'Argentina'),
  ('co', 'Colombia'),
  ('cl', 'Chile'),
  ('pe', 'Peru'),
  ('ec', 'Ecuador'),
  ('ie', 'Ireland'),
  ('nz', 'New Zealand'),
  ('jp', 'Japan'),
  ('in', 'India')
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name;

ALTER TABLE public.country_codes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS country_codes_read ON public.country_codes;
CREATE POLICY country_codes_read ON public.country_codes FOR SELECT USING (true);
GRANT SELECT ON TABLE public.country_codes TO anon, authenticated, service_role;

-- ─── 2) Normalize any stored/sent value to ISO 3166-1 alpha-2 lowercase ───────

CREATE OR REPLACE FUNCTION public.normalize_country_code (p_value text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v text;
BEGIN
  v := lower(btrim(coalesce(p_value, '')));
  IF v = '' OR v = 'all' THEN
    RETURN 'us';
  END IF;

  v := CASE v
    WHEN 'usa' THEN 'us'
    WHEN 'united states' THEN 'us'
    WHEN 'united states of america' THEN 'us'
    WHEN 'u.s.' THEN 'us'
    WHEN 'u.s.a.' THEN 'us'
    WHEN 'canada' THEN 'ca'
    WHEN 'mexico' THEN 'mx'
    WHEN 'méxico' THEN 'mx'
    WHEN 'uk' THEN 'gb'
    WHEN 'united kingdom' THEN 'gb'
    WHEN 'great britain' THEN 'gb'
    WHEN 'england' THEN 'gb'
    WHEN 'australia' THEN 'au'
    WHEN 'germany' THEN 'de'
    WHEN 'deutschland' THEN 'de'
    WHEN 'france' THEN 'fr'
    WHEN 'spain' THEN 'es'
    WHEN 'españa' THEN 'es'
    WHEN 'italy' THEN 'it'
    WHEN 'italia' THEN 'it'
    WHEN 'netherlands' THEN 'nl'
    WHEN 'holland' THEN 'nl'
    WHEN 'brazil' THEN 'br'
    WHEN 'brasil' THEN 'br'
    WHEN 'argentina' THEN 'ar'
    WHEN 'colombia' THEN 'co'
    WHEN 'chile' THEN 'cl'
    WHEN 'peru' THEN 'pe'
    WHEN 'perú' THEN 'pe'
    WHEN 'ecuador' THEN 'ec'
    WHEN 'ireland' THEN 'ie'
    WHEN 'new zealand' THEN 'nz'
    WHEN 'japan' THEN 'jp'
    WHEN 'india' THEN 'in'
    ELSE v
  END;

  IF v ~ '^[a-z]{2}$' THEN
    RETURN v;
  END IF;
  RETURN 'us';
END;
$$;

COMMENT ON FUNCTION public.normalize_country_code (text) IS
  'Maps a country name or code to ISO 3166-1 alpha-2 lowercase. Unknown values become us.';

CREATE OR REPLACE FUNCTION public.country_display_name (p_code text)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT coalesce(
    (SELECT name FROM public.country_codes WHERE code = public.normalize_country_code(p_code)),
    'United States'
  );
$$;

-- ─── 3) get_user_country — the only way backend code should read country ──────

CREATE OR REPLACE FUNCTION public.get_user_country (p_user_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_raw text;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN 'us';
  END IF;

  SELECT company_country INTO v_raw
  FROM public.profiles
  WHERE user_id = p_user_id
  LIMIT 1;

  RETURN public.normalize_country_code(v_raw);
END;
$$;

COMMENT ON FUNCTION public.get_user_country (uuid) IS
  'Registration country (ISO alpha-2 lowercase) for this account. Every feature that needs a country must call this.';

GRANT EXECUTE ON FUNCTION public.normalize_country_code (text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.country_display_name (text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_user_country (uuid) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.country_is_provided (p_value text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT p_value IS NOT NULL AND btrim(p_value) <> '';
$$;

CREATE OR REPLACE FUNCTION public.resolve_entity_country (p_sent text, p_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT CASE
    WHEN public.country_is_provided(p_sent) THEN public.normalize_country_code(p_sent)
    ELSE public.get_user_country(p_user_id)
  END;
$$;

COMMENT ON FUNCTION public.resolve_entity_country (text, uuid) IS
  'Keeps a caller-supplied country (normalized). If omitted, uses get_user_country(p_user_id).';

GRANT EXECUTE ON FUNCTION public.country_is_provided (text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_entity_country (text, uuid) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_user_country_info (p_user_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT jsonb_build_object(
    'country', upper(public.get_user_country(p_user_id)),
    'country_name', public.country_display_name(public.get_user_country(p_user_id))
  );
$$;

REVOKE ALL ON FUNCTION public.get_user_country_info (uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_country_info (uuid) TO authenticated, service_role;

-- GET /me/country equivalent (uses the session).
CREATE OR REPLACE FUNCTION public.get_my_country ()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  RETURN public.get_user_country_info(auth.uid());
END;
$$;

COMMENT ON FUNCTION public.get_my_country () IS
  'Current user registration country. Shape: { country: "US", country_name: "United States" }.';

GRANT EXECUTE ON FUNCTION public.get_my_country () TO authenticated;
REVOKE ALL ON FUNCTION public.get_my_country () FROM anon, PUBLIC;

-- ─── 4) Normalize + freeze profiles.company_country after first set ───────────

CREATE OR REPLACE FUNCTION public.lock_profile_company_country ()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.company_country IS NOT NULL
     AND btrim(OLD.company_country) <> '' THEN
    NEW.company_country := public.normalize_country_code(OLD.company_country);
  ELSE
    NEW.company_country := public.normalize_country_code(NEW.company_country);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_lock_profile_company_country ON public.profiles;
CREATE TRIGGER tr_lock_profile_company_country
  BEFORE INSERT OR UPDATE OF company_country ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.lock_profile_company_country ();

-- Copy country into auth.users metadata so login (session.user.user_metadata) includes it.
CREATE OR REPLACE FUNCTION public.sync_auth_user_country ()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code text;
BEGIN
  v_code := public.normalize_country_code(NEW.company_country);
  UPDATE auth.users
  SET raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
    || jsonb_build_object(
         'country', upper(v_code),
         'country_name', public.country_display_name(v_code)
       )
  WHERE id = NEW.user_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_sync_auth_user_country ON public.profiles;
CREATE TRIGGER tr_sync_auth_user_country
  AFTER INSERT OR UPDATE OF company_country, user_id ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_auth_user_country ();

UPDATE public.profiles
SET company_country = public.normalize_country_code(company_country)
WHERE company_country IS DISTINCT FROM public.normalize_country_code(company_country)
   OR company_country IS NULL;

-- ─── 5) Country columns on address-bearing tables ─────────────────────────────

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS billing_country text,
  ADD COLUMN IF NOT EXISTS service_country text;

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS country text;

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS property_country text;

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS country text;

ALTER TABLE public.estimates
  ADD COLUMN IF NOT EXISTS country text;

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS country text;

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS country text;

ALTER TABLE public.walkthroughs
  ADD COLUMN IF NOT EXISTS country text;

ALTER TABLE public.client_properties
  ADD COLUMN IF NOT EXISTS country text;

ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS country text;

COMMENT ON COLUMN public.clients.billing_country IS 'ISO alpha-2. Uses the request value when provided; otherwise the owner registration country.';
COMMENT ON COLUMN public.clients.service_country IS 'ISO alpha-2. Uses the request value when provided; otherwise the owner registration country.';
COMMENT ON COLUMN public.employees.country IS 'ISO alpha-2. Uses the request value when provided; otherwise the owner registration country.';
COMMENT ON COLUMN public.jobs.property_country IS 'ISO alpha-2. Uses the request value when provided; otherwise the owner registration country.';
COMMENT ON COLUMN public.invoices.country IS 'ISO alpha-2. Uses the request value when provided; otherwise the owner registration country.';
COMMENT ON COLUMN public.estimates.country IS 'ISO alpha-2. Uses the request value when provided; otherwise the owner registration country.';
COMMENT ON COLUMN public.leads.country IS 'ISO alpha-2. Uses the request value when provided; otherwise the owner registration country.';
COMMENT ON COLUMN public.bookings.country IS 'ISO alpha-2. Uses the request value when provided; otherwise the business owner registration country.';
COMMENT ON COLUMN public.walkthroughs.country IS 'ISO alpha-2. Uses the request value when provided; otherwise the owner registration country.';
COMMENT ON COLUMN public.client_properties.country IS 'ISO alpha-2. Uses the request value when provided; otherwise the owner registration country.';
COMMENT ON COLUMN public.contracts.country IS 'ISO alpha-2. Uses the request value when provided; otherwise the owner registration country.';

-- ─── 6) Triggers: keep request country if present, else get_user_country() ────

CREATE OR REPLACE FUNCTION public.enforce_registration_country ()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_owner uuid;
BEGIN
  IF TG_ARGV[0] = 'business_owner_id' THEN
    v_owner := NEW.business_owner_id;
  ELSE
    v_owner := NEW.user_id;
  END IF;

  CASE TG_ARGV[1]
    WHEN 'client_countries' THEN
      NEW.billing_country := public.resolve_entity_country(NEW.billing_country, v_owner);
      NEW.service_country := public.resolve_entity_country(NEW.service_country, v_owner);
    WHEN 'property_country' THEN
      NEW.property_country := public.resolve_entity_country(NEW.property_country, v_owner);
    ELSE
      NEW.country := public.resolve_entity_country(NEW.country, v_owner);
  END CASE;

  RETURN NEW;
END;
$$;

-- Names start with zz_ so they run after other BEFORE triggers that fill user_id.
DROP TRIGGER IF EXISTS tr_country_clients ON public.clients;
DROP TRIGGER IF EXISTS zz_enforce_country_clients ON public.clients;
CREATE TRIGGER zz_enforce_country_clients
  BEFORE INSERT OR UPDATE ON public.clients
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_registration_country ('user_id', 'client_countries');

DROP TRIGGER IF EXISTS tr_country_employees ON public.employees;
DROP TRIGGER IF EXISTS zz_enforce_country_employees ON public.employees;
CREATE TRIGGER zz_enforce_country_employees
  BEFORE INSERT OR UPDATE ON public.employees
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_registration_country ('user_id', 'country');

DROP TRIGGER IF EXISTS tr_country_jobs ON public.jobs;
DROP TRIGGER IF EXISTS zz_enforce_country_jobs ON public.jobs;
CREATE TRIGGER zz_enforce_country_jobs
  BEFORE INSERT OR UPDATE ON public.jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_registration_country ('user_id', 'property_country');

DROP TRIGGER IF EXISTS tr_country_invoices ON public.invoices;
DROP TRIGGER IF EXISTS zz_enforce_country_invoices ON public.invoices;
CREATE TRIGGER zz_enforce_country_invoices
  BEFORE INSERT OR UPDATE ON public.invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_registration_country ('user_id', 'country');

DROP TRIGGER IF EXISTS tr_country_estimates ON public.estimates;
DROP TRIGGER IF EXISTS zz_enforce_country_estimates ON public.estimates;
CREATE TRIGGER zz_enforce_country_estimates
  BEFORE INSERT OR UPDATE ON public.estimates
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_registration_country ('user_id', 'country');

DROP TRIGGER IF EXISTS tr_country_leads ON public.leads;
DROP TRIGGER IF EXISTS zz_enforce_country_leads ON public.leads;
CREATE TRIGGER zz_enforce_country_leads
  BEFORE INSERT OR UPDATE ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_registration_country ('user_id', 'country');

DROP TRIGGER IF EXISTS tr_country_bookings ON public.bookings;
DROP TRIGGER IF EXISTS zz_enforce_country_bookings ON public.bookings;
CREATE TRIGGER zz_enforce_country_bookings
  BEFORE INSERT OR UPDATE ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_registration_country ('business_owner_id', 'country');

DROP TRIGGER IF EXISTS tr_country_walkthroughs ON public.walkthroughs;
DROP TRIGGER IF EXISTS zz_enforce_country_walkthroughs ON public.walkthroughs;
CREATE TRIGGER zz_enforce_country_walkthroughs
  BEFORE INSERT OR UPDATE ON public.walkthroughs
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_registration_country ('user_id', 'country');

DROP TRIGGER IF EXISTS tr_country_client_properties ON public.client_properties;
DROP TRIGGER IF EXISTS zz_enforce_country_client_properties ON public.client_properties;
CREATE TRIGGER zz_enforce_country_client_properties
  BEFORE INSERT OR UPDATE ON public.client_properties
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_registration_country ('user_id', 'country');

DROP TRIGGER IF EXISTS tr_country_contracts ON public.contracts;
DROP TRIGGER IF EXISTS zz_enforce_country_contracts ON public.contracts;
CREATE TRIGGER zz_enforce_country_contracts
  BEFORE INSERT OR UPDATE ON public.contracts
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_registration_country ('user_id', 'country');

-- Backfill without firing schedule/email/notify triggers.
SET session_replication_role = replica;

UPDATE public.clients c
SET billing_country = public.get_user_country(c.user_id),
    service_country = public.get_user_country(c.user_id);

UPDATE public.employees e
SET country = public.get_user_country(e.user_id);

UPDATE public.jobs j
SET property_country = public.get_user_country(j.user_id);

UPDATE public.invoices i
SET country = public.get_user_country(i.user_id);

UPDATE public.estimates e
SET country = public.get_user_country(e.user_id);

UPDATE public.leads l
SET country = public.get_user_country(l.user_id);

UPDATE public.bookings b
SET country = public.get_user_country(b.business_owner_id);

UPDATE public.walkthroughs w
SET country = public.get_user_country(w.user_id);

UPDATE public.client_properties p
SET country = public.get_user_country(p.user_id);

UPDATE public.contracts c
SET country = public.get_user_country(c.user_id);

SET session_replication_role = DEFAULT;

-- Public company profile may include country so booking/maps can restrict later.
CREATE OR REPLACE FUNCTION public.get_public_company_profile(p_user_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT to_jsonb(p)
  FROM (
    SELECT
      first_name,
      last_name,
      company_name,
      company_logo,
      company_email,
      company_phone,
      company_address,
      company_apt_suite,
      company_city,
      company_state,
      company_zip,
      public.get_user_country(user_id) AS company_country,
      public.country_display_name(public.get_user_country(user_id)) AS company_country_name
    FROM public.profiles
    WHERE user_id = p_user_id
    LIMIT 1
  ) p;
$$;

REVOKE ALL ON FUNCTION public.get_public_company_profile(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_company_profile(uuid) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
