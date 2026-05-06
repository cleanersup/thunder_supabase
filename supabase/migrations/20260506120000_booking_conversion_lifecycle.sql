-- Booking lifecycle: status constraint, FK to estimates/walkthroughs, RPCs, status-change emails via pg_net.

CREATE EXTENSION IF NOT EXISTS pg_net;
  DROP CONSTRAINT IF EXISTS bookings_status_check;

ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_status_check
  CHECK (status IN ('new', 'converted', 'cancelled', 'archived'));

ALTER TABLE public.estimates
  ADD COLUMN IF NOT EXISTS booking_id uuid REFERENCES public.bookings (id) ON DELETE SET NULL;

ALTER TABLE public.walkthroughs
  ADD COLUMN IF NOT EXISTS booking_id uuid REFERENCES public.bookings (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_estimates_booking_id ON public.estimates (booking_id)
  WHERE booking_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_walkthroughs_booking_id ON public.walkthroughs (booking_id)
  WHERE booking_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_estimates_booking_id ON public.estimates (booking_id)
  WHERE booking_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_walkthroughs_booking_id ON public.walkthroughs (booking_id)
  WHERE booking_id IS NOT NULL;

-- One booking may not link to both an estimate and a walkthrough.
CREATE OR REPLACE FUNCTION public.enforce_booking_single_conversion_target ()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path = public
  AS $$
BEGIN
  IF NEW.booking_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'estimates' THEN
    IF EXISTS (
      SELECT 1
      FROM public.walkthroughs w
      WHERE w.booking_id = NEW.booking_id) THEN
      RAISE EXCEPTION 'Booking % is already linked to a walkthrough', NEW.booking_id;
    END IF;
  ELSIF TG_TABLE_NAME = 'walkthroughs' THEN
    IF EXISTS (
      SELECT 1
      FROM public.estimates e
      WHERE e.booking_id = NEW.booking_id) THEN
      RAISE EXCEPTION 'Booking % is already linked to an estimate', NEW.booking_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_enforce_booking_target_estimates ON public.estimates;

CREATE TRIGGER tr_enforce_booking_target_estimates
  BEFORE INSERT OR UPDATE OF booking_id ON public.estimates
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_booking_single_conversion_target ();

DROP TRIGGER IF EXISTS tr_enforce_booking_target_walkthroughs ON public.walkthroughs;

CREATE TRIGGER tr_enforce_booking_target_walkthroughs
  BEFORE INSERT OR UPDATE OF booking_id ON public.walkthroughs
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_booking_single_conversion_target ();

CREATE OR REPLACE FUNCTION public.get_booking_with_conversion (p_booking_id uuid)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY INVOKER
  SET search_path = public
  AS $$
DECLARE
  jb jsonb;
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
  RETURN jsonb_build_object('booking', jb, 'estimate', (
      SELECT
        to_jsonb (e.*)
      FROM
        estimates e
      WHERE
        e.booking_id = p_booking_id
        AND e.user_id = auth.uid ()
      LIMIT 1), 'walkthrough', (
      SELECT
        to_jsonb (w.*)
      FROM
        walkthroughs w
      WHERE
        w.booking_id = p_booking_id
        AND w.user_id = auth.uid ()
      LIMIT 1));
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
  IF p_estimate_id IS NOT NULL THEN
    UPDATE
      estimates
    SET
      booking_id = p_booking_id
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
      booking_id = p_booking_id
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

CREATE OR REPLACE FUNCTION public.booking_archive (p_booking_id uuid)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = public
  AS $$
DECLARE
  v_rows int;
BEGIN
  IF auth.uid () IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  UPDATE
    bookings
  SET
    status = 'archived'
  WHERE
    id = p_booking_id
    AND business_owner_id = auth.uid ()
    AND status IN ('new', 'converted', 'cancelled');
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'Booking not found or cannot be archived from current state';
  END IF;
  RETURN public.get_booking_with_conversion (p_booking_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.booking_cancel (p_booking_id uuid)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = public
  AS $$
DECLARE
  v_rows int;
BEGIN
  IF auth.uid () IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  UPDATE
    bookings
  SET
    status = 'cancelled'
  WHERE
    id = p_booking_id
    AND business_owner_id = auth.uid ()
    AND status IN ('new', 'converted');
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'Booking not found or cannot be cancelled from current state';
  END IF;
  RETURN public.get_booking_with_conversion (p_booking_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.booking_restore (p_booking_id uuid)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = public
  AS $$
DECLARE
  v_rows int;
BEGIN
  IF auth.uid () IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  UPDATE
    bookings
  SET
    status = 'new'
  WHERE
    id = p_booking_id
    AND business_owner_id = auth.uid ()
    AND status = 'archived';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'Booking not found or not archived';
  END IF;
  RETURN public.get_booking_with_conversion (p_booking_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_booking_with_conversion (uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION public.finalize_booking_conversion (uuid, uuid, uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION public.booking_archive (uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION public.booking_cancel (uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION public.booking_restore (uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.notify_booking_status_change_send_email ()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
  AS $$
DECLARE
  request_id bigint;
  function_url text;
BEGIN
  function_url := coalesce(nullif(current_setting('app.settings.supabase_url', TRUE), ''), 'https://euydrdzayvjahstvmwoj.supabase.co')
|| '/functions/v1/send-booking-status-emails';
  SELECT
    net.http_post (url := function_url, headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || coalesce(nullif(current_setting('app.settings.service_role_key', TRUE), ''), '')), body := jsonb_build_object('bookingId', NEW.id::text, 'previousStatus', OLD.status, 'newStatus', NEW.status))
  INTO
    request_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_booking_status_change_send_email ON public.bookings;

CREATE TRIGGER on_booking_status_change_send_email
  AFTER UPDATE OF status ON public.bookings
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.notify_booking_status_change_send_email ();

COMMENT ON FUNCTION public.finalize_booking_conversion (uuid, uuid, uuid) IS 'Link an estimate or walkthrough to a booking; set booking status to converted.';

COMMENT ON FUNCTION public.get_booking_with_conversion (uuid) IS 'Booking row as JSON plus linked estimate and walkthrough if any.';
