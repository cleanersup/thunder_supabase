-- When resolving a booking's linked estimate, prefer finalized rows over orphaned drafts.

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
    e.user_id = auth.uid ()
    AND (
      e.booking_id = p_booking_id
      OR (v_converted_id IS NOT NULL AND e.id = v_converted_id))
  ORDER BY
    CASE lower(trim(COALESCE(e.status, 'draft')))
      WHEN 'draft' THEN 2
      ELSE 1
    END,
    e.updated_at DESC NULLS LAST
  LIMIT 1;

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

COMMENT ON FUNCTION public.get_booking_with_conversion (uuid) IS 'Booking row as JSON plus linked estimate and walkthrough. Prefers finalized estimates over draft rows for the same booking.';
