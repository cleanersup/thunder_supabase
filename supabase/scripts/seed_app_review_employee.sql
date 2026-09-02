-- Seed App Store Review demo employee for Thunder Pro Crew.
-- Phone: 9999999999  |  Fixed OTP: 123456 (edge functions skip SMS for this phone)
--
-- BEFORE RUNNING:
-- 1) Replace OWNER_USER_ID below with a real profiles.user_id / auth.users.id
--    (a company Apple can browse — e.g. your own Thunder Pro account).
-- 2) Run on the SAME environment the App Store binary hits (usually production),
--    and also staging if you test there.
--
-- Example to find an owner:
--   SELECT u.id, u.email, p.company_name
--   FROM auth.users u
--   JOIN public.profiles p ON p.user_id = u.id
--   WHERE u.email ILIKE '%your@company.com%';

BEGIN;

DO $$
DECLARE
  -- <<< REPLACE with a real company owner (profiles.user_id / auth.users.id) >>>
  v_owner_id uuid := '00000000-0000-0000-0000-000000000000';
  v_employee_id uuid;
  v_client_id uuid;
  v_job_id uuid;
  v_today date := (now() AT TIME ZONE 'America/New_York')::date;
BEGIN
  IF v_owner_id = '00000000-0000-0000-0000-000000000000' THEN
    RAISE EXCEPTION 'Replace v_owner_id with a real company owner user_id before running';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = v_owner_id) THEN
    RAISE EXCEPTION 'No profile for owner %', v_owner_id;
  END IF;

  -- 1) Demo employee (upsert by phone + owner)
  SELECT id INTO v_employee_id
  FROM public.employees
  WHERE user_id = v_owner_id
    AND phone = '9999999999'
  LIMIT 1;

  IF v_employee_id IS NULL THEN
    INSERT INTO public.employees (
      user_id,
      first_name,
      last_name,
      position,
      gender,
      status,
      phone,
      email
    ) VALUES (
      v_owner_id,
      'Apple',
      'Reviewer',
      'Crew Member',
      'male',
      'active',
      '9999999999',
      'app-review-crew@thunderpro.co'
    )
    RETURNING id INTO v_employee_id;
    RAISE NOTICE 'Created employee %', v_employee_id;
  ELSE
    UPDATE public.employees
    SET
      status = 'active',
      first_name = 'Apple',
      last_name = 'Reviewer',
      phone = '9999999999'
    WHERE id = v_employee_id;
    RAISE NOTICE 'Updated existing employee %', v_employee_id;
  END IF;

  -- 2) Demo client (for a job address)
  SELECT id INTO v_client_id
  FROM public.clients
  WHERE user_id = v_owner_id
    AND email = 'app-review-client@thunderpro.co'
  LIMIT 1;

  IF v_client_id IS NULL THEN
    INSERT INTO public.clients (
      user_id,
      full_name,
      email,
      phone,
      billing_street,
      billing_city,
      billing_state,
      billing_zip,
      service_street,
      service_city,
      service_state,
      service_zip,
      client_type,
      contact_preference
    ) VALUES (
      v_owner_id,
      'App Review Client',
      'app-review-client@thunderpro.co',
      '5550001111',
      '1 Infinite Loop',
      'Cupertino',
      'CA',
      '95014',
      '1 Infinite Loop',
      'Cupertino',
      'CA',
      '95014',
      'residential',
      'email'
    )
    RETURNING id INTO v_client_id;
  END IF;

  -- 3) One job scheduled for "today" (owner local date approx America/New_York)
  --    so Schedule / My Jobs / Clock In are not empty.
  SELECT id INTO v_job_id
  FROM public.jobs
  WHERE user_id = v_owner_id
    AND client_email = 'app-review-client@thunderpro.co'
    AND scheduled_date = v_today
    AND status IN ('today', 'upcoming', 'scheduled')
  LIMIT 1;

  IF v_job_id IS NULL THEN
    INSERT INTO public.jobs (
      user_id,
      client_id,
      client_name,
      client_email,
      client_phone,
      property_street,
      property_city,
      property_state,
      property_zip,
      assigned_employees,
      service_type,
      job_type,
      scheduled_date,
      start_time,
      end_time,
      service_details,
      status,
      site_latitude,
      site_longitude,
      geofence_radius_meters
    ) VALUES (
      v_owner_id,
      v_client_id,
      'App Review Client',
      'app-review-client@thunderpro.co',
      '5550001111',
      '1 Infinite Loop',
      'Cupertino',
      'CA',
      '95014',
      jsonb_build_array(
        jsonb_build_object(
          'id', v_employee_id,
          'name', 'Apple Reviewer'
        )
      ),
      'residential',
      'one_time',
      v_today,
      '09:00',
      '11:00',
      'App Store review demo job — safe to clock in for testing.',
      'today',
      -- Cupertino HQ coords so geofence can be tested if reviewer is nearby;
      -- for remote review, clock-in without job / or widen radius as needed.
      37.3318,
      -122.0312,
      50000
    )
    RETURNING id INTO v_job_id;
    RAISE NOTICE 'Created job % for %', v_job_id, v_today;
  ELSE
    UPDATE public.jobs
    SET
      assigned_employees = jsonb_build_array(
        jsonb_build_object('id', v_employee_id, 'name', 'Apple Reviewer')
      ),
      status = 'today',
      geofence_radius_meters = 50000
    WHERE id = v_job_id;
    RAISE NOTICE 'Updated existing job %', v_job_id;
  END IF;

  RAISE NOTICE '=== App Review seed done ===';
  RAISE NOTICE 'Phone: 9999999999';
  RAISE NOTICE 'OTP:   123456';
  RAISE NOTICE 'Employee: %', v_employee_id;
  RAISE NOTICE 'Job:      %', v_job_id;
END $$;

COMMIT;
