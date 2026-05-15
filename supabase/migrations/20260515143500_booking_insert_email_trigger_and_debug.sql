-- Booking email trigger improvements:
-- 1) Fire on INSERT (new booking created) and status UPDATE.
-- 2) Include trigger operation in payload for easier debugging.

CREATE OR REPLACE FUNCTION public.notify_booking_status_change_send_email ()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
  AS $$
DECLARE
  request_id bigint;
  function_url text;
  v_previous_status text;
BEGIN
  function_url := coalesce(nullif(current_setting('app.settings.supabase_url', TRUE), ''), 'https://euydrdzayvjahstvmwoj.supabase.co')
|| '/functions/v1/send-booking-status-emails';

  IF TG_OP = 'INSERT' THEN
    v_previous_status := NULL;
  ELSE
    v_previous_status := OLD.status;
  END IF;

  SELECT
    net.http_post (
      url := function_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || coalesce(nullif(current_setting('app.settings.service_role_key', TRUE), ''), '')
      ),
      body := jsonb_build_object(
        'bookingId', NEW.id::text,
        'previousStatus', v_previous_status,
        'newStatus', NEW.status,
        'operation', TG_OP
      )
    )
  INTO
    request_id;

  RAISE LOG '[booking-email-trigger] operation=% booking_id=% previous_status=% new_status=% request_id=%',
    TG_OP, NEW.id, v_previous_status, NEW.status, request_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_booking_insert_send_email ON public.bookings;
CREATE TRIGGER on_booking_insert_send_email
  AFTER INSERT ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_booking_status_change_send_email ();

DROP TRIGGER IF EXISTS on_booking_status_change_send_email ON public.bookings;
CREATE TRIGGER on_booking_status_change_send_email
  AFTER UPDATE OF status ON public.bookings
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.notify_booking_status_change_send_email ();
