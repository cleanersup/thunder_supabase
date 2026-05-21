-- Link bookings to client_properties and align primary property with the address used on the request.
--
-- Context: the mobile/web request edit form auto-selects the client's primary (favorite) property
-- when properties load, overwriting the booking address fields. The booking row already stores the
-- correct street/city/state/zip, but no property id was persisted.
--
-- Backend-only mitigation:
--   1) Resolve and store bookings.client_property_id from the saved address + client_id.
--   2) After save, promote that property to primary so the existing frontend prefill picks it up.
--
-- Trade-off: saving a request at a non-primary address updates which property is marked primary
-- for that client. bookings.client_property_id is stored for a future frontend fix that reads it
-- directly instead of relying on is_primary.

-- ── Booking contact columns (used by requestService; may already exist in some envs) ────────────

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES public.clients (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS lead_id uuid REFERENCES public.leads (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS contact_type text,
  ADD COLUMN IF NOT EXISTS client_property_id uuid REFERENCES public.client_properties (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_bookings_client_id
  ON public.bookings (client_id)
  WHERE client_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bookings_client_property_id
  ON public.bookings (client_property_id)
  WHERE client_property_id IS NOT NULL;

COMMENT ON COLUMN public.bookings.client_property_id IS
  'Client property whose address matches this booking. Set automatically from address fields when client_id is present.';

-- ── Address normalization + property matching ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.normalize_booking_address_part (p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT NULLIF(lower(trim(both from coalesce(p_value, ''))), '');
$$;

CREATE OR REPLACE FUNCTION public.match_client_property_for_booking (
  p_client_id uuid,
  p_street text,
  p_apt text,
  p_city text,
  p_state text,
  p_zip text
)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id
  FROM public.client_properties p
  WHERE p.client_id = p_client_id
    AND p.is_active = true
    AND public.normalize_booking_address_part(p.street) = public.normalize_booking_address_part(p_street)
    AND public.normalize_booking_address_part(p.city) = public.normalize_booking_address_part(p_city)
    AND public.normalize_booking_address_part(p.state) = public.normalize_booking_address_part(p_state)
    AND public.normalize_booking_address_part(p.zip_code) = public.normalize_booking_address_part(p_zip)
    AND (
      public.normalize_booking_address_part(p.apt_suite) IS NOT DISTINCT FROM
      public.normalize_booking_address_part(p_apt)
    )
  ORDER BY p.is_primary DESC, p.created_at ASC
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.match_client_property_for_booking (uuid, text, text, text, text, text) IS
  'Find the active client property whose address matches a booking address (case/whitespace insensitive).';

-- ── BEFORE: resolve client_property_id on insert/update ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.sync_booking_client_property_id ()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.client_id IS NULL THEN
    NEW.client_property_id := NULL;
    RETURN NEW;
  END IF;

  NEW.client_property_id := public.match_client_property_for_booking(
    NEW.client_id,
    NEW.street,
    NEW.apt_suite,
    NEW.city,
    NEW.state,
    NEW.zip_code
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_sync_booking_client_property_id ON public.bookings;

CREATE TRIGGER tr_sync_booking_client_property_id
  BEFORE INSERT OR UPDATE OF client_id, street, apt_suite, city, state, zip_code
  ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_booking_client_property_id();

-- ── AFTER: promote matched property so edit form auto-select picks the right address ────────────

CREATE OR REPLACE FUNCTION public.promote_client_property_for_booking (p_property_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_property_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.client_properties
  SET is_primary = true
  WHERE id = p_property_id
    AND is_active = true
    AND is_primary = false;
END;
$$;

CREATE OR REPLACE FUNCTION public.promote_booking_client_property_after_save ()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.client_property_id IS NOT NULL THEN
    PERFORM public.promote_client_property_for_booking(NEW.client_property_id);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_promote_booking_client_property ON public.bookings;

CREATE TRIGGER tr_promote_booking_client_property
  AFTER INSERT OR UPDATE OF client_id, street, apt_suite, city, state, zip_code, client_property_id
  ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.promote_booking_client_property_after_save();

GRANT EXECUTE ON FUNCTION public.match_client_property_for_booking (uuid, text, text, text, text, text) TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.promote_client_property_for_booking (uuid) TO authenticated, service_role;

-- ── Backfill existing bookings (oldest → newest so the latest request wins for primary) ─────────

DO $$
DECLARE
  r record;
  v_property_id uuid;
BEGIN
  FOR r IN
    SELECT
      b.id,
      b.client_id,
      b.street,
      b.apt_suite,
      b.city,
      b.state,
      b.zip_code
    FROM public.bookings b
    WHERE b.client_id IS NOT NULL
    ORDER BY b.created_at ASC
  LOOP
    v_property_id := public.match_client_property_for_booking(
      r.client_id,
      r.street,
      r.apt_suite,
      r.city,
      r.state,
      r.zip_code
    );

    IF v_property_id IS NOT NULL THEN
      UPDATE public.bookings
      SET client_property_id = v_property_id
      WHERE id = r.id
        AND client_property_id IS DISTINCT FROM v_property_id;

      PERFORM public.promote_client_property_for_booking(v_property_id);
    END IF;
  END LOOP;
END;
$$;
