-- Tests for registration-country lock.
-- Run after 20260929180000_lock_user_registration_country.sql:
--   docker exec -i supabase_db_euydrdzayvjahstvmwoj psql -U postgres -d postgres < supabase/tests/lock_user_registration_country.sql

CREATE OR REPLACE FUNCTION pg_temp.assert_eq(p_label text, p_got text, p_expected text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_got IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION '%: expected %, got %', p_label, p_expected, p_got;
  END IF;
END;
$$;

DO $$
DECLARE
  v_uid uuid := 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeee0001';
  v_client_id uuid;
  v_employee_id uuid;
  v_job_id uuid;
  v_invoice_id uuid;
  v_lead_id uuid;
  v_booking_id uuid;
  v_walkthrough_id uuid;
  v_property_id uuid;
  v_meta jsonb;
  v_me jsonb;
  v_country text;
BEGIN
  PERFORM pg_temp.assert_eq(
    'normalize United States',
    public.normalize_country_code('United States'),
    'us'
  );
  PERFORM pg_temp.assert_eq(
    'normalize CA',
    public.normalize_country_code('CA'),
    'ca'
  );
  PERFORM pg_temp.assert_eq(
    'unknown falls back to us',
    public.normalize_country_code('Narnia'),
    'us'
  );

  DELETE FROM public.client_properties WHERE user_id = v_uid;
  DELETE FROM public.clients WHERE user_id = v_uid;
  DELETE FROM public.employees WHERE user_id = v_uid;
  DELETE FROM public.jobs WHERE user_id = v_uid;
  DELETE FROM public.invoices WHERE user_id = v_uid;
  DELETE FROM public.estimates WHERE user_id = v_uid;
  DELETE FROM public.leads WHERE user_id = v_uid;
  DELETE FROM public.bookings WHERE business_owner_id = v_uid;
  DELETE FROM public.walkthroughs WHERE user_id = v_uid;
  DELETE FROM public.contracts WHERE user_id = v_uid;
  DELETE FROM public.profiles WHERE user_id = v_uid;
  DELETE FROM auth.users WHERE id = v_uid;

  INSERT INTO auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at,
    confirmation_token,
    email_change,
    email_change_token_new,
    recovery_token
  ) VALUES (
    '00000000-0000-0000-0000-000000000000',
    v_uid,
    'authenticated',
    'authenticated',
    'country-lock-test@example.com',
    crypt('test-password', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now(),
    '',
    '',
    '',
    ''
  );

  INSERT INTO public.profiles (user_id, first_name, last_name, company_name, company_country)
  VALUES (v_uid, 'Country', 'Lock', 'Lock Co', 'ca');

  PERFORM pg_temp.assert_eq(
    'stored country is lowercase ISO',
    (SELECT company_country FROM public.profiles WHERE user_id = v_uid),
    'ca'
  );
  PERFORM pg_temp.assert_eq(
    'get_user_country helper',
    public.get_user_country(v_uid),
    'ca'
  );
  PERFORM pg_temp.assert_eq(
    'resolve_entity_country keeps sent value',
    public.resolve_entity_country('MX', v_uid),
    'mx'
  );
  PERFORM pg_temp.assert_eq(
    'resolve_entity_country falls back when omitted',
    public.resolve_entity_country(NULL, v_uid),
    'ca'
  );

  SELECT raw_user_meta_data INTO v_meta FROM auth.users WHERE id = v_uid;
  PERFORM pg_temp.assert_eq('login metadata country', v_meta ->> 'country', 'CA');
  PERFORM pg_temp.assert_eq('login metadata country_name', v_meta ->> 'country_name', 'Canada');

  PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text,
    true
  );
  v_me := public.get_my_country();
  PERFORM pg_temp.assert_eq('get_my_country country', v_me ->> 'country', 'CA');
  PERFORM pg_temp.assert_eq('get_my_country country_name', v_me ->> 'country_name', 'Canada');

  INSERT INTO public.clients (
    user_id, full_name, phone, email,
    billing_street, billing_city, billing_state, billing_zip,
    service_street, service_city, service_state, service_zip,
    client_type, contact_preference
  ) VALUES (
    v_uid, 'No Country Client', '555-0000', 'client@example.com',
    '1 Main', 'Toronto', 'ON', 'M5V 1A1',
    '1 Main', 'Toronto', 'ON', 'M5V 1A1',
    'residential', 'email'
  )
  RETURNING id INTO v_client_id;

  SELECT billing_country INTO v_country FROM public.clients WHERE id = v_client_id;
  PERFORM pg_temp.assert_eq('client country omitted', v_country, 'ca');
  SELECT service_country INTO v_country FROM public.clients WHERE id = v_client_id;
  PERFORM pg_temp.assert_eq('client service country omitted', v_country, 'ca');

  UPDATE public.clients
  SET billing_country = 'mx', service_country = 'us'
  WHERE id = v_client_id;

  SELECT billing_country INTO v_country FROM public.clients WHERE id = v_client_id;
  PERFORM pg_temp.assert_eq('client country kept from request', v_country, 'mx');
  SELECT service_country INTO v_country FROM public.clients WHERE id = v_client_id;
  PERFORM pg_temp.assert_eq('client service country kept from request', v_country, 'us');

  UPDATE public.clients
  SET billing_country = NULL, service_country = NULL
  WHERE id = v_client_id;
  SELECT billing_country INTO v_country FROM public.clients WHERE id = v_client_id;
  PERFORM pg_temp.assert_eq('client country filled when cleared', v_country, 'ca');

  UPDATE public.profiles SET company_country = 'mx' WHERE user_id = v_uid;
  PERFORM pg_temp.assert_eq(
    'registration country stays locked',
    public.get_user_country(v_uid),
    'ca'
  );

  INSERT INTO public.employees (
    user_id, first_name, last_name, position, gender, street, city, state, zip, country
  ) VALUES (
    v_uid, 'Pat', 'Lee', 'cleaner', 'female', '9 King', 'Toronto', 'ON', 'M5V 1A1', 'us'
  )
  RETURNING id INTO v_employee_id;
  SELECT country INTO v_country FROM public.employees WHERE id = v_employee_id;
  PERFORM pg_temp.assert_eq('employee country kept from request', v_country, 'us');

  INSERT INTO public.jobs (
    user_id, service_type, service_details, scheduled_date, property_country
  ) VALUES (
    v_uid, 'residential', 'Clean', CURRENT_DATE, 'mx'
  )
  RETURNING id INTO v_job_id;
  SELECT property_country INTO v_country FROM public.jobs WHERE id = v_job_id;
  PERFORM pg_temp.assert_eq('job country kept from request', v_country, 'mx');

  INSERT INTO public.invoices (
    user_id, invoice_number, client_name, email, phone,
    address, city, state, zip, service_type, total, status, invoice_date, due_date, country
  ) VALUES (
    v_uid, 'TEST-COUNTRY-LOCK-1', 'No Country Client', 'client@example.com', '555-0000',
    '1 Main', 'Toronto', 'ON', 'M5V 1A1', 'residential', 10, 'Draft', CURRENT_DATE, CURRENT_DATE, 'us'
  )
  RETURNING id INTO v_invoice_id;
  SELECT country INTO v_country FROM public.invoices WHERE id = v_invoice_id;
  PERFORM pg_temp.assert_eq('invoice country kept from request', v_country, 'us');

  INSERT INTO public.leads (
    user_id, full_name, phone, email, address, city, state, zip_code,
    lead_source, service_interested, priority_level, country
  ) VALUES (
    v_uid, 'Lead One', '555-1111', 'lead@example.com', '2 Queen', 'Toronto', 'ON', 'M5V 1A1',
    'web', 'cleaning', 'high', 'us'
  )
  RETURNING id INTO v_lead_id;
  SELECT country INTO v_country FROM public.leads WHERE id = v_lead_id;
  PERFORM pg_temp.assert_eq('lead country kept from request', v_country, 'us');

  INSERT INTO public.bookings (
    business_owner_id, lead_name, email, phone, service_type,
    street, city, state, zip_code, country
  ) VALUES (
    v_uid, 'Public Lead', 'public@example.com', '555-2222', 'residential',
    '3 King', 'Toronto', 'ON', 'M5V 1A1', 'mx'
  )
  RETURNING id INTO v_booking_id;
  SELECT country INTO v_country FROM public.bookings WHERE id = v_booking_id;
  PERFORM pg_temp.assert_eq('booking country kept from request', v_country, 'mx');

  INSERT INTO public.walkthroughs (
    user_id, walkthrough_type, service_type, scheduled_date, scheduled_time, country
  ) VALUES (
    v_uid, 'lead', 'residential', CURRENT_DATE, '09:00', 'us'
  )
  RETURNING id INTO v_walkthrough_id;
  SELECT country INTO v_country FROM public.walkthroughs WHERE id = v_walkthrough_id;
  PERFORM pg_temp.assert_eq('walkthrough country kept from request', v_country, 'us');

  INSERT INTO public.client_properties (
    user_id, client_id, street, city, state, zip_code, country
  ) VALUES (
    v_uid, v_client_id, '4 King', 'Toronto', 'ON', 'M5V 1A1', 'us'
  )
  RETURNING id INTO v_property_id;
  SELECT country INTO v_country FROM public.client_properties WHERE id = v_property_id;
  PERFORM pg_temp.assert_eq('property country kept from request', v_country, 'us');

  INSERT INTO public.estimates (
    user_id, client_name, email, phone, address, city, state, zip,
    service_type, subtotal, total, country
  ) VALUES (
    v_uid, 'No Country Client', 'client@example.com', '555-0000',
    '1 Main', 'Toronto', 'ON', 'M5V 1A1', 'residential', 10, 10, 'us'
  );
  PERFORM pg_temp.assert_eq(
    'estimate country kept from request',
    (SELECT country FROM public.estimates WHERE user_id = v_uid LIMIT 1),
    'us'
  );

  INSERT INTO public.contracts (
    user_id, contract_number, recipient_name, country
  ) VALUES (
    v_uid, 'TEST-COUNTRY-LOCK', 'Pat Lee', 'mx'
  );
  PERFORM pg_temp.assert_eq(
    'contract country kept from request',
    (SELECT country FROM public.contracts WHERE user_id = v_uid LIMIT 1),
    'mx'
  );

  DELETE FROM public.client_properties WHERE user_id = v_uid;
  DELETE FROM public.clients WHERE user_id = v_uid;
  DELETE FROM public.employees WHERE user_id = v_uid;
  DELETE FROM public.jobs WHERE user_id = v_uid;
  DELETE FROM public.invoices WHERE user_id = v_uid;
  DELETE FROM public.estimates WHERE user_id = v_uid;
  DELETE FROM public.leads WHERE user_id = v_uid;
  DELETE FROM public.bookings WHERE business_owner_id = v_uid;
  DELETE FROM public.walkthroughs WHERE user_id = v_uid;
  DELETE FROM public.contracts WHERE user_id = v_uid;
  DELETE FROM public.profiles WHERE user_id = v_uid;
  DELETE FROM auth.users WHERE id = v_uid;

  RAISE NOTICE 'lock_user_registration_country tests passed';
END;
$$;
