-- Case-insensitive client lookup for Stripe webhook vault (invoice email vs CRM clients.email).

CREATE OR REPLACE FUNCTION public.get_client_id_for_invoice_vault(p_user_id uuid, p_email text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT c.id
  FROM public.clients c
  WHERE c.user_id = p_user_id
    AND lower(trim(c.email)) = lower(trim(p_email))
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_client_id_for_invoice_vault(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_client_id_for_invoice_vault(uuid, text) TO service_role;
