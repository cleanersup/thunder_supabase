-- Create a webhook to trigger the send-employee-sms edge function when a new employee is inserted
-- First, we need to enable the pg_net extension if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Create a function to send the webhook
CREATE OR REPLACE FUNCTION public.send_employee_welcome_sms()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  request_id bigint;
  function_url text;
BEGIN
  -- Construct the edge function URL
  function_url := current_setting('app.settings.supabase_url', true) || '/functions/v1/send-employee-sms';
  
  -- If the setting is not available, use the default pattern
  IF function_url IS NULL OR function_url = '' THEN
    function_url := 'https://euydrdzayvjahstvmwoj.supabase.co/functions/v1/send-employee-sms';
  END IF;

  -- Make an async HTTP POST request to the edge function
  SELECT net.http_post(
    url := function_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body := jsonb_build_object(
      'type', 'INSERT',
      'table', 'employees',
      'record', row_to_json(NEW),
      'schema', 'public'
    )
  ) INTO request_id;

  RETURN NEW;
END;
$$;

-- Create the trigger
DROP TRIGGER IF EXISTS on_employee_created ON public.employees;

CREATE TRIGGER on_employee_created
  AFTER INSERT ON public.employees
  FOR EACH ROW
  EXECUTE FUNCTION public.send_employee_welcome_sms();