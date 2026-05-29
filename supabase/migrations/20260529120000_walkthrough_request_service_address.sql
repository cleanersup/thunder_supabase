-- Persist service address on walkthroughs when converted from a request (parity with estimates).

ALTER TABLE public.walkthroughs
  ADD COLUMN IF NOT EXISTS service_street text,
  ADD COLUMN IF NOT EXISTS service_apt text,
  ADD COLUMN IF NOT EXISTS service_city text,
  ADD COLUMN IF NOT EXISTS service_state text,
  ADD COLUMN IF NOT EXISTS service_zip text,
  ADD COLUMN IF NOT EXISTS property_title text;

COMMENT ON COLUMN public.walkthroughs.service_street IS 'Service address copied from the linked request/booking at conversion time.';
COMMENT ON COLUMN public.walkthroughs.property_title IS 'Client property label from the request (e.g. Primary property, Casa Secundaria).';

-- Backfill existing request-linked walkthroughs from bookings.
UPDATE public.walkthroughs w
SET
  service_street = b.street,
  service_apt = b.apt_suite,
  service_city = b.city,
  service_state = b.state,
  service_zip = b.zip_code,
  property_title = COALESCE(
    NULLIF(trim(cp.title), ''),
    CASE WHEN cp.is_primary THEN 'Primary property' ELSE NULL END
  )
FROM public.bookings b
LEFT JOIN public.client_properties cp ON cp.id = b.client_property_id
WHERE w.service_street IS NULL
  AND b.street IS NOT NULL
  AND (
    w.booking_id = b.id
    OR (b.converted_to_type = 'walkthrough' AND b.converted_to_id = w.id)
  );

-- Ensure booking_id is set when only converted_to_* was persisted.
UPDATE public.walkthroughs w
SET booking_id = b.id
FROM public.bookings b
WHERE w.booking_id IS NULL
  AND b.converted_to_type = 'walkthrough'
  AND b.converted_to_id = w.id;
