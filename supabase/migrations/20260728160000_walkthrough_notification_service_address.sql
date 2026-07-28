-- Include selected service address in walkthrough owner notifications.
CREATE OR REPLACE FUNCTION public.notify_owner_walkthrough_status ()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_title text;
  v_msg   text;
  v_type  text;
  v_service text;
  v_address text;
BEGIN
  v_service := coalesce(NEW.service_type, 'walkthrough');

  v_address := nullif(trim(both from concat_ws(', ',
    nullif(trim(both from concat_ws(' ', NEW.service_street, NEW.service_apt)), ''),
    nullif(trim(both from concat_ws(' ', NEW.service_city, NEW.service_state, NEW.service_zip)), '')
  )), '');

  IF NEW.status = 'Completed' THEN
    v_type := 'walkthrough_completed';
    v_title := 'Walkthrough completed';
    v_msg := 'A ' || v_service || ' walkthrough was completed'
      || coalesce(' at ' || v_address, '') || '.';
  ELSIF NEW.status = 'Cancelled' THEN
    v_type := 'walkthrough_cancelled';
    v_title := 'Walkthrough cancelled';
    v_msg := 'A ' || v_service || ' walkthrough was cancelled'
      || coalesce(' at ' || v_address, '') || '.';
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications (user_id, type, title, message, related_id, related_type)
  VALUES (NEW.user_id, v_type, v_title, v_msg, NEW.id, 'walkthrough');

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.notify_owner_walkthrough_status () IS
  'Creates an owner notification (which then pushes) on walkthrough completed/cancelled, including service address when set.';
