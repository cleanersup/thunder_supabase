-- Replace DB-trigger-based booking status emails with explicit backend dispatch calls.
-- This keeps email sending tied to backend operations (insert/cancel/archive/restore/convert)
-- without relying on table triggers.

CREATE EXTENSION IF NOT EXISTS pg_net;

-- 1) Shared dispatcher used by booking RPCs (explicit calls, not triggers).
CREATE OR REPLACE FUNCTION public.dispatch_booking_status_email (
  p_booking_id uuid,
  p_previous_status text,
  p_new_status text,
  p_operation text DEFAULT 'UPDATE'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  request_id bigint;
  function_url text;
BEGIN
  -- Prefer configured URL; for local self-hosted fallback use kong gateway.
  function_url := coalesce(
    nullif(current_setting('app.settings.supabase_url', TRUE), ''),
    'http://kong:8000'
  ) || '/functions/v1/send-booking-status-emails';

  SELECT
    net.http_post(
      url := function_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || coalesce(nullif(current_setting('app.settings.service_role_key', TRUE), ''), '')
      ),
      body := jsonb_build_object(
        'bookingId', p_booking_id::text,
        'previousStatus', p_previous_status,
        'newStatus', p_new_status,
        'operation', p_operation
      )
    )
  INTO request_id;

  RAISE LOG '[dispatch-booking-email] operation=% booking_id=% previous_status=% new_status=% request_id=%',
    p_operation, p_booking_id, p_previous_status, p_new_status, request_id;
END;
$$;

COMMENT ON FUNCTION public.dispatch_booking_status_email (uuid, text, text, text) IS
'Explicit booking status email dispatch helper for backend RPC flows.';

-- 2) Remove booking email table triggers (no DB-trigger-driven sends).
DROP TRIGGER IF EXISTS on_booking_insert_send_email ON public.bookings;
DROP TRIGGER IF EXISTS on_booking_status_change_send_email ON public.bookings;

-- Keep old trigger function unused (safe), or drop if present.
DROP FUNCTION IF EXISTS public.notify_booking_status_change_send_email();

-- 3) Recreate RPCs with explicit dispatch calls

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

  PERFORM public.dispatch_booking_status_email(p_booking_id, v_status, 'converted', 'UPDATE');

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
  v_prev_status text;
BEGIN
  IF auth.uid () IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT status
  INTO v_prev_status
  FROM bookings
  WHERE id = p_booking_id
    AND business_owner_id = auth.uid ();

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

  PERFORM public.dispatch_booking_status_email(p_booking_id, v_prev_status, 'archived', 'UPDATE');

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
  v_prev_status text;
BEGIN
  IF auth.uid () IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT status
  INTO v_prev_status
  FROM bookings
  WHERE id = p_booking_id
    AND business_owner_id = auth.uid ();

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

  PERFORM public.dispatch_booking_status_email(p_booking_id, v_prev_status, 'cancelled', 'UPDATE');

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
  v_prev_status text;
BEGIN
  IF auth.uid () IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT status
  INTO v_prev_status
  FROM bookings
  WHERE id = p_booking_id
    AND business_owner_id = auth.uid ();

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

  PERFORM public.dispatch_booking_status_email(p_booking_id, v_prev_status, 'new', 'UPDATE');

  RETURN public.get_booking_with_conversion (p_booking_id);
END;
$$;
