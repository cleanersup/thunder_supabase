-- Function to automatically log invoice activities
CREATE OR REPLACE FUNCTION log_invoice_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Log invoice creation
  IF TG_OP = 'INSERT' THEN
    INSERT INTO activities (user_id, type, title, invoice_number, client_name, amount)
    VALUES (
      NEW.user_id,
      'invoice_created',
      'Invoice ' || NEW.invoice_number || ' created for ' || NEW.client_name,
      NEW.invoice_number,
      NEW.client_name,
      NEW.total
    );
  END IF;

  -- Log invoice payment
  IF TG_OP = 'UPDATE' AND OLD.status != 'paid' AND NEW.status = 'paid' THEN
    INSERT INTO activities (user_id, type, title, invoice_number, client_name, amount)
    VALUES (
      NEW.user_id,
      'invoice_paid',
      'Invoice ' || NEW.invoice_number || ' paid by ' || NEW.client_name || ' ($' || NEW.total || ')',
      NEW.invoice_number,
      NEW.client_name,
      NEW.total
    );
  END IF;

  -- Log invoice cancellation
  IF TG_OP = 'UPDATE' AND OLD.status != 'canceled' AND NEW.status = 'canceled' THEN
    INSERT INTO activities (user_id, type, title, invoice_number, client_name, amount)
    VALUES (
      NEW.user_id,
      'invoice_canceled',
      'Invoice ' || NEW.invoice_number || ' canceled',
      NEW.invoice_number,
      NEW.client_name,
      NEW.total
    );
  END IF;

  RETURN NEW;
END;
$$;

-- Function to automatically log estimate activities
CREATE OR REPLACE FUNCTION log_estimate_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Log estimate creation
  IF TG_OP = 'INSERT' THEN
    INSERT INTO activities (user_id, type, title, estimate_number, client_name, amount)
    VALUES (
      NEW.user_id,
      'estimate_created',
      'Estimate created for ' || NEW.client_name,
      COALESCE(NEW.id::text, 'N/A'),
      NEW.client_name,
      NEW.total
    );
  END IF;

  -- Log estimate acceptance
  IF TG_OP = 'UPDATE' AND OLD.status != 'Accepted' AND NEW.status = 'Accepted' THEN
    INSERT INTO activities (user_id, type, title, estimate_number, client_name, amount)
    VALUES (
      NEW.user_id,
      'estimate_accepted',
      'Estimate accepted by ' || NEW.client_name,
      COALESCE(NEW.id::text, 'N/A'),
      NEW.client_name,
      NEW.total
    );
  END IF;

  -- Log estimate cancellation
  IF TG_OP = 'UPDATE' AND OLD.status != 'Canceled' AND NEW.status = 'Canceled' THEN
    INSERT INTO activities (user_id, type, title, estimate_number, client_name, amount)
    VALUES (
      NEW.user_id,
      'estimate_canceled',
      'Estimate canceled for ' || NEW.client_name,
      COALESCE(NEW.id::text, 'N/A'),
      NEW.client_name,
      NEW.total
    );
  END IF;

  RETURN NEW;
END;
$$;

-- Function to log client activities
CREATE OR REPLACE FUNCTION log_client_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO activities (user_id, type, title, client_name)
    VALUES (
      NEW.user_id,
      'client_created',
      'New client added: ' || NEW.full_name,
      NEW.full_name
    );
  END IF;

  RETURN NEW;
END;
$$;

-- Function to log lead activities
CREATE OR REPLACE FUNCTION log_lead_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO activities (user_id, type, title, client_name)
    VALUES (
      NEW.user_id,
      'lead_created',
      'New lead added: ' || NEW.full_name,
      NEW.full_name
    );
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status != NEW.status THEN
    INSERT INTO activities (user_id, type, title, client_name)
    VALUES (
      NEW.user_id,
      'lead_updated',
      'Lead updated: ' || NEW.full_name || ' - Status: ' || NEW.status,
      NEW.full_name
    );
  END IF;

  RETURN NEW;
END;
$$;

-- Function to log booking activities
CREATE OR REPLACE FUNCTION log_booking_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO activities (user_id, type, title, client_name)
    VALUES (
      NEW.business_owner_id,
      'booking_received',
      'New booking from ' || NEW.lead_name || ' for ' || NEW.service_type,
      NEW.lead_name
    );
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status != NEW.status THEN
    INSERT INTO activities (user_id, type, title, client_name)
    VALUES (
      NEW.business_owner_id,
      'booking_updated',
      'Booking updated for ' || NEW.lead_name || ' - Status: ' || NEW.status,
      NEW.lead_name
    );
  END IF;

  RETURN NEW;
END;
$$;

-- Function to log route activities
CREATE OR REPLACE FUNCTION log_route_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO activities (user_id, type, title)
    VALUES (
      NEW.user_id,
      'route_created',
      'Route "' || NEW.name || '" created'
    );
  END IF;

  RETURN NEW;
END;
$$;

-- Function to log appointment activities
CREATE OR REPLACE FUNCTION log_appointment_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_name text;
  v_route_name text;
BEGIN
  -- Get client and route names
  SELECT c.full_name INTO v_client_name
  FROM clients c
  WHERE c.id = NEW.client_id;

  SELECT r.name INTO v_route_name
  FROM routes r
  WHERE r.id = NEW.route_id;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO activities (user_id, type, title, client_name)
    VALUES (
      NEW.user_id,
      'appointment_created',
      'Appointment scheduled for ' || COALESCE(v_client_name, 'Unknown') || ' on ' || COALESCE(v_route_name, 'route'),
      v_client_name
    );
  END IF;

  IF TG_OP = 'UPDATE' AND (OLD.scheduled_date != NEW.scheduled_date OR OLD.status != NEW.status) THEN
    INSERT INTO activities (user_id, type, title, client_name)
    VALUES (
      NEW.user_id,
      'appointment_updated',
      'Appointment updated for ' || COALESCE(v_client_name, 'Unknown') || ' - ' || NEW.status,
      v_client_name
    );
  END IF;

  RETURN NEW;
END;
$$;

-- Function to log task activities
CREATE OR REPLACE FUNCTION log_task_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_name text;
BEGIN
  -- Get client name if task is linked to a client
  IF NEW.client_id IS NOT NULL THEN
    SELECT c.full_name INTO v_client_name
    FROM clients c
    WHERE c.id = NEW.client_id;
  END IF;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO activities (user_id, type, title, client_name)
    VALUES (
      NEW.user_id,
      'task_created',
      'Task created: ' || NEW.title || CASE WHEN v_client_name IS NOT NULL THEN ' for ' || v_client_name ELSE '' END,
      v_client_name
    );
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status != 'completed' AND NEW.status = 'completed' THEN
    INSERT INTO activities (user_id, type, title, client_name)
    VALUES (
      NEW.user_id,
      'task_completed',
      'Task completed: ' || NEW.title || CASE WHEN v_client_name IS NOT NULL THEN ' for ' || v_client_name ELSE '' END,
      v_client_name
    );
  END IF;

  RETURN NEW;
END;
$$;

-- Create triggers
DROP TRIGGER IF EXISTS trigger_log_invoice_activity ON invoices;
CREATE TRIGGER trigger_log_invoice_activity
  AFTER INSERT OR UPDATE ON invoices
  FOR EACH ROW
  EXECUTE FUNCTION log_invoice_activity();

DROP TRIGGER IF EXISTS trigger_log_estimate_activity ON estimates;
CREATE TRIGGER trigger_log_estimate_activity
  AFTER INSERT OR UPDATE ON estimates
  FOR EACH ROW
  EXECUTE FUNCTION log_estimate_activity();

DROP TRIGGER IF EXISTS trigger_log_client_activity ON clients;
CREATE TRIGGER trigger_log_client_activity
  AFTER INSERT ON clients
  FOR EACH ROW
  EXECUTE FUNCTION log_client_activity();

DROP TRIGGER IF EXISTS trigger_log_lead_activity ON leads;
CREATE TRIGGER trigger_log_lead_activity
  AFTER INSERT OR UPDATE ON leads
  FOR EACH ROW
  EXECUTE FUNCTION log_lead_activity();

DROP TRIGGER IF EXISTS trigger_log_booking_activity ON bookings;
CREATE TRIGGER trigger_log_booking_activity
  AFTER INSERT OR UPDATE ON bookings
  FOR EACH ROW
  EXECUTE FUNCTION log_booking_activity();

DROP TRIGGER IF EXISTS trigger_log_route_activity ON routes;
CREATE TRIGGER trigger_log_route_activity
  AFTER INSERT ON routes
  FOR EACH ROW
  EXECUTE FUNCTION log_route_activity();

DROP TRIGGER IF EXISTS trigger_log_appointment_activity ON route_appointments;
CREATE TRIGGER trigger_log_appointment_activity
  AFTER INSERT OR UPDATE ON route_appointments
  FOR EACH ROW
  EXECUTE FUNCTION log_appointment_activity();

DROP TRIGGER IF EXISTS trigger_log_task_activity ON tasks;
CREATE TRIGGER trigger_log_task_activity
  AFTER INSERT OR UPDATE ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION log_task_activity();