-- Denormalize booking conversion target so requests can show linked estimate/walkthrough
-- without relying solely on estimates.booking_id / walkthroughs.booking_id joins.

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS converted_to_type text,
  ADD COLUMN IF NOT EXISTS converted_to_id uuid;

ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_converted_to_type_check;

ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_converted_to_type_check
  CHECK (converted_to_type IS NULL OR converted_to_type IN ('estimate', 'walkthrough'));

CREATE INDEX IF NOT EXISTS idx_bookings_converted_to_id
  ON public.bookings (converted_to_id)
  WHERE converted_to_id IS NOT NULL;

-- Backfill from existing booking_id links (estimate wins when both exist).
UPDATE public.bookings b
SET
  converted_to_type = 'estimate',
  converted_to_id = e.id
FROM public.estimates e
WHERE
  e.booking_id = b.id
  AND b.converted_to_type IS NULL;

UPDATE public.bookings b
SET
  converted_to_type = 'walkthrough',
  converted_to_id = w.id
FROM public.walkthroughs w
WHERE
  w.booking_id = b.id
  AND b.converted_to_type IS NULL
  AND b.status = 'converted';

CREATE OR REPLACE FUNCTION public.get_booking_with_conversion (p_booking_id uuid)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY INVOKER
  SET search_path = public
  AS $$
DECLARE
  jb jsonb;
  v_estimate jsonb;
  v_walkthrough jsonb;
  v_converted_type text;
  v_converted_id uuid;
BEGIN
  IF auth.uid () IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT
    to_jsonb (b.*) INTO jb
  FROM
    bookings b
  WHERE
    b.id = p_booking_id
    AND b.business_owner_id = auth.uid ();

  IF jb IS NULL THEN
    RETURN NULL;
  END IF;

  v_converted_type := jb ->> 'converted_to_type';
  v_converted_id := NULLIF(jb ->> 'converted_to_id', '')::uuid;

  SELECT
    to_jsonb (e.*) INTO v_estimate
  FROM
    public.estimates e
  WHERE
    e.booking_id = p_booking_id
    AND e.user_id = auth.uid ()
  ORDER BY
    e.updated_at DESC
  LIMIT 1;

  IF v_estimate IS NULL AND v_converted_type = 'estimate' AND v_converted_id IS NOT NULL THEN
    SELECT
      to_jsonb (e.*) INTO v_estimate
    FROM
      public.estimates e
    WHERE
      e.id = v_converted_id
      AND e.user_id = auth.uid ()
    LIMIT 1;
  END IF;

  SELECT
    to_jsonb (w.*) INTO v_walkthrough
  FROM
    public.walkthroughs w
  WHERE
    w.booking_id = p_booking_id
    AND w.user_id = auth.uid ()
  ORDER BY
    w.updated_at DESC
  LIMIT 1;

  IF v_walkthrough IS NULL AND v_converted_type = 'walkthrough' AND v_converted_id IS NOT NULL THEN
    SELECT
      to_jsonb (w.*) INTO v_walkthrough
    FROM
      public.walkthroughs w
    WHERE
      w.id = v_converted_id
      AND w.user_id = auth.uid ()
    LIMIT 1;
  END IF;

  RETURN jsonb_build_object('booking', jb, 'estimate', v_estimate, 'walkthrough', v_walkthrough);
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_booking_conversion (
  p_booking_id uuid,
  p_estimate_id uuid DEFAULT NULL,
  p_walkthrough_id uuid DEFAULT NULL
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = public
  AS $$
DECLARE
  v_owner uuid;
  v_status text;
  v_rows int;
  v_wt_for_booking uuid;
  v_est_wt uuid;
BEGIN
  IF auth.uid () IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF (p_estimate_id IS NULL) = (p_walkthrough_id IS NULL) THEN
    RAISE EXCEPTION 'Provide exactly one of p_estimate_id or p_walkthrough_id';
  END IF;

  SELECT
    business_owner_id,
    status INTO v_owner,
    v_status
  FROM
    bookings
  WHERE
    id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found';
  END IF;
  IF v_owner <> auth.uid () THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  IF v_status IS DISTINCT FROM 'new' THEN
    RAISE EXCEPTION 'Booking must be in status new to convert (current: %)', v_status;
  END IF;

  SELECT
    w.id INTO v_wt_for_booking
  FROM
    walkthroughs w
  WHERE
    w.booking_id = p_booking_id
    AND w.user_id = auth.uid ()
  LIMIT 1;

  IF p_estimate_id IS NOT NULL THEN
    SELECT
      e.walkthrough_id INTO v_est_wt
    FROM
      estimates e
    WHERE
      e.id = p_estimate_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Estimate not found';
    END IF;

    IF v_wt_for_booking IS NOT NULL THEN
      IF v_est_wt IS NOT NULL AND v_est_wt IS DISTINCT FROM v_wt_for_booking THEN
        RAISE EXCEPTION 'Estimate is linked to a different walkthrough than the one for this booking';
      END IF;
    END IF;

    UPDATE
      estimates
    SET
      booking_id = p_booking_id,
      walkthrough_id = COALESCE(walkthrough_id, v_wt_for_booking),
      is_draft = TRUE
    WHERE
      id = p_estimate_id
      AND user_id = auth.uid ()
      AND (booking_id IS NULL
        OR booking_id = p_booking_id);

    GET DIAGNOSTICS v_rows = ROW_COUNT;

    IF v_rows <> 1 THEN
      RAISE EXCEPTION 'Estimate not found, not owned, or already linked to another booking';
    END IF;
  ELSE
    UPDATE
      walkthroughs
    SET
      booking_id = p_booking_id,
      status = 'Draft'
    WHERE
      id = p_walkthrough_id
      AND user_id = auth.uid ()
      AND (booking_id IS NULL
        OR booking_id = p_booking_id);

    GET DIAGNOSTICS v_rows = ROW_COUNT;

    IF v_rows <> 1 THEN
      RAISE EXCEPTION 'Walkthrough not found, not owned, or already linked to another booking';
    END IF;
  END IF;

  UPDATE
    bookings
  SET
    status = 'converted',
    converted_to_type = CASE
      WHEN p_estimate_id IS NOT NULL THEN 'estimate'
      ELSE 'walkthrough'
    END,
    converted_to_id = COALESCE(p_estimate_id, p_walkthrough_id)
  WHERE
    id = p_booking_id;

  PERFORM public.dispatch_booking_status_email(p_booking_id, v_status, 'converted', 'UPDATE');

  RETURN public.get_booking_with_conversion (p_booking_id);
END;
$$;

COMMENT ON COLUMN public.bookings.converted_to_type IS 'Denormalized conversion target: estimate or walkthrough.';
COMMENT ON COLUMN public.bookings.converted_to_id IS 'Primary key of the estimate or walkthrough created from this booking.';
COMMENT ON FUNCTION public.get_booking_with_conversion (uuid) IS 'Booking row as JSON plus linked estimate and walkthrough (by booking_id or converted_to_id fallback).';
COMMENT ON FUNCTION public.finalize_booking_conversion (uuid, uuid, uuid) IS 'Link an estimate or walkthrough to a booking; set booking status to converted and persist converted_to_* columns.';
