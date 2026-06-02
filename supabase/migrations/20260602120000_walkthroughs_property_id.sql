-- Optional link from walkthrough to the client property being inspected.

ALTER TABLE public.walkthroughs
  ADD COLUMN IF NOT EXISTS property_id uuid REFERENCES public.client_properties (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_walkthroughs_property_id
  ON public.walkthroughs (property_id)
  WHERE property_id IS NOT NULL;

COMMENT ON COLUMN public.walkthroughs.property_id IS
  'Optional reference to the client property to inspect.';

-- Backfill from linked requests when a property was already stored on the booking.
UPDATE public.walkthroughs w
SET property_id = b.client_property_id
FROM public.bookings b
WHERE w.booking_id = b.id
  AND w.property_id IS NULL
  AND b.client_property_id IS NOT NULL;
