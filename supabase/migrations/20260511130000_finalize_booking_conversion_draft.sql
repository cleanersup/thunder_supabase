-- When a booking (public request) is converted via finalize_booking_conversion,
-- persist the linked estimate as draft and the linked walkthrough as status Draft
-- so owners finish the wizard before sending/scheduling.

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
    status = 'converted'
  WHERE
    id = p_booking_id;
  RETURN public.get_booking_with_conversion (p_booking_id);
END;
$$;

COMMENT ON FUNCTION public.finalize_booking_conversion (uuid, uuid, uuid) IS 'Link an estimate or walkthrough to a booking; set booking status to converted. Estimate branch sets is_draft true; walkthrough branch sets status Draft. If the booking already has a walkthrough, linking an estimate sets estimates.walkthrough_id to that walkthrough.';
