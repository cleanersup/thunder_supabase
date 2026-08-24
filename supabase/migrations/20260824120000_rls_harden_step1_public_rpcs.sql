-- Step 1: close tables that have no public UI, add token/id RPCs for public pages.
-- Keep existing anon SELECT policies on profiles/invoices/estimates/contracts/booking_forms
-- until frontends call these RPCs (see 20260824120100).

-- ─── walkthrough_reminders_sent ───────────────────────────────────────────────
-- "Service role can manage…" FOR ALL USING (true) applied to anon as well.
-- service_role already bypasses RLS; the owner SELECT policy remains.

DROP POLICY IF EXISTS "Service role can manage walkthrough reminders"
  ON public.walkthrough_reminders_sent;

-- ─── route_appointments (employee embed leak) ─────────────────────────────────
-- Policy used a subquery on time_entries. Combined with the definer-based
-- time_entries SELECT, anon could read appointment notes (door codes, etc.).

DROP POLICY IF EXISTS "Employees can view their assigned appointments"
  ON public.route_appointments;

-- ─── time_entries SELECT: owners only ─────────────────────────────────────────
-- is_valid_employee_for_entry() is SECURITY DEFINER and only checks that the
-- employee belongs to the company — not that the caller is that employee.
-- Anon therefore could SELECT every row. Clock-in/out stays on edge functions.
-- Swift-slate employee dashboard must use get_employee_time_entries (below).

DROP POLICY IF EXISTS "Company owners and employees can view time entries"
  ON public.time_entries;

DROP POLICY IF EXISTS "Company owners can view time entries"
  ON public.time_entries;

CREATE POLICY "Company owners can view time entries"
  ON public.time_entries
  FOR SELECT
  USING (auth.uid() = user_id);

-- ─── storage.avatars: stop anon LIST, keep owner access ───────────────────────
-- Public bucket URLs (/object/public/avatars/...) stay available. Listing via
-- REST uses storage.objects SELECT and must not be open to anon.

DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND (
        COALESCE(qual, '') ILIKE '%avatars%'
        OR COALESCE(with_check, '') ILIKE '%avatars%'
      )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', pol.policyname);
  END LOOP;
END $$;

DROP POLICY IF EXISTS "Authenticated users can manage own avatars" ON storage.objects;

CREATE POLICY "Authenticated users can manage own avatars"
  ON storage.objects
  FOR ALL
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- ─── helpers ──────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._is_uuid(p_value text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
$$;

REVOKE ALL ON FUNCTION public._is_uuid(text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public._digits_phone(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN length(d) = 11 AND left(d, 1) = '1' THEN substring(d FROM 2)
    ELSE d
  END
  FROM (SELECT regexp_replace(COALESCE(p_value, ''), '[^0-9]', '', 'g') AS d) s;
$$;

REVOKE ALL ON FUNCTION public._digits_phone(text) FROM PUBLIC;

-- ─── public company branding (no stripe, no personal phone, no tokens) ────────

CREATE OR REPLACE FUNCTION public.get_public_company_profile(p_user_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT to_jsonb(p)
  FROM (
    SELECT
      first_name,
      last_name,
      company_name,
      company_logo,
      company_email,
      company_phone,
      company_address,
      company_apt_suite,
      company_city,
      company_state,
      company_zip
    FROM public.profiles
    WHERE user_id = p_user_id
    LIMIT 1
  ) p;
$$;

-- ─── booking form questions ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_public_booking_forms(p_user_id uuid)
RETURNS TABLE (form_type text, custom_questions jsonb)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT bf.form_type, bf.custom_questions
  FROM public.booking_forms bf
  WHERE bf.user_id = p_user_id;
$$;

-- ─── invoice by payment_token or legacy UUID id ───────────────────────────────

CREATE OR REPLACE FUNCTION public.get_public_invoice(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_row jsonb;
BEGIN
  IF p_token IS NULL OR btrim(p_token) = '' THEN
    RETURN NULL;
  END IF;

  SELECT to_jsonb(i)
  INTO v_row
  FROM public.invoices i
  WHERE i.status IS DISTINCT FROM 'Draft'
    AND (
      i.payment_token = p_token
      OR (public._is_uuid(p_token) AND i.id = p_token::uuid)
    )
  LIMIT 1;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_invoice_merchant_profile(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_row jsonb;
BEGIN
  IF p_token IS NULL OR btrim(p_token) = '' THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_build_object(
    'company_name', p.company_name,
    'company_logo', p.company_logo,
    'company_phone', p.company_phone,
    'stripe_account_id', p.stripe_account_id,
    'stripe_onboarding_completed', p.stripe_onboarding_completed
  )
  INTO v_row
  FROM public.invoices i
  JOIN public.profiles p ON p.user_id = i.user_id
  WHERE i.status IS DISTINCT FROM 'Draft'
    AND (
      i.payment_token = p_token
      OR (public._is_uuid(p_token) AND i.id = p_token::uuid)
    )
  LIMIT 1;

  RETURN v_row;
END;
$$;

-- ─── estimate by share token (or UUID id of a shared estimate) ────────────────

CREATE OR REPLACE FUNCTION public.get_public_estimate(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_id uuid;
  v_row jsonb;
BEGIN
  IF p_token IS NULL OR btrim(p_token) = '' THEN
    RETURN NULL;
  END IF;

  SELECT e.id
  INTO v_id
  FROM public.estimates e
  WHERE e.public_share_token = p_token
     OR (
       public._is_uuid(p_token)
       AND e.id = p_token::uuid
       AND e.public_share_token IS NOT NULL
     )
  LIMIT 1;

  IF v_id IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE public.estimates
  SET viewed_at = COALESCE(viewed_at, now())
  WHERE id = v_id
    AND viewed_at IS NULL;

  SELECT to_jsonb(e)
  INTO v_row
  FROM public.estimates e
  WHERE e.id = v_id;

  RETURN v_row;
END;
$$;

-- ─── contract by public_share_token ───────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_public_contract(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_row jsonb;
BEGIN
  IF p_token IS NULL OR btrim(p_token) = '' THEN
    RETURN NULL;
  END IF;

  SELECT to_jsonb(c)
  INTO v_row
  FROM public.contracts c
  WHERE c.status IS DISTINCT FROM 'Draft'
    AND (
      c.public_share_token::text = p_token
      OR (public._is_uuid(p_token) AND c.id = p_token::uuid AND c.public_share_token IS NOT NULL)
    )
  LIMIT 1;

  RETURN v_row;
END;
$$;

-- ─── employee time entries (swift-slate employee dashboard, not Crew) ─────────

CREATE OR REPLACE FUNCTION public.get_employee_time_entries(
  p_employee_id uuid,
  p_phone text,
  p_statuses text[] DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_ascending boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_phone text;
  v_ok boolean;
  v_limit integer;
BEGIN
  v_phone := public._digits_phone(p_phone);
  IF p_employee_id IS NULL OR length(v_phone) < 10 THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.employees e
    WHERE e.id = p_employee_id
      AND public._digits_phone(e.phone) = v_phone
  ) INTO v_ok;

  IF NOT v_ok THEN
    RETURN '[]'::jsonb;
  END IF;

  v_limit := GREATEST(1, LEAST(COALESCE(p_limit, 50), 100));

  RETURN COALESCE(
    (
      SELECT jsonb_agg(
        item
        ORDER BY
          CASE WHEN p_ascending THEN sort_date END ASC,
          CASE WHEN NOT p_ascending THEN sort_date END DESC,
          CASE WHEN p_ascending THEN sort_created END ASC,
          CASE WHEN NOT p_ascending THEN sort_created END DESC
      )
      FROM (
        SELECT
          te.date AS sort_date,
          te.created_at AS sort_created,
          to_jsonb(te) || jsonb_build_object(
            'route_appointments',
            CASE
              WHEN ra.id IS NULL THEN NULL
              ELSE to_jsonb(ra) || jsonb_build_object(
                'clients',
                CASE
                  WHEN c.id IS NULL THEN NULL
                  ELSE jsonb_build_object(
                    'service_street', c.service_street,
                    'service_apt', c.service_apt,
                    'service_city', c.service_city,
                    'service_state', c.service_state,
                    'service_zip', c.service_zip
                  )
                END
              )
            END
          ) AS item
        FROM public.time_entries te
        LEFT JOIN public.route_appointments ra ON ra.id = te.route_appointment_id
        LEFT JOIN public.clients c ON c.id = ra.client_id
        WHERE te.employee_id = p_employee_id
          AND (p_statuses IS NULL OR te.status = ANY (p_statuses))
        ORDER BY
          CASE WHEN p_ascending THEN te.date END ASC,
          CASE WHEN NOT p_ascending THEN te.date END DESC,
          CASE WHEN p_ascending THEN te.created_at END ASC,
          CASE WHEN NOT p_ascending THEN te.created_at END DESC
        LIMIT v_limit
      ) s
    ),
    '[]'::jsonb
  );
END;
$$;

-- ─── grants ───────────────────────────────────────────────────────────────────

REVOKE ALL ON FUNCTION public.get_public_company_profile(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_public_booking_forms(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_public_invoice(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_invoice_merchant_profile(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_public_estimate(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_public_contract(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_employee_time_entries(uuid, text, text[], integer, boolean) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_public_company_profile(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_booking_forms(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_invoice(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_invoice_merchant_profile(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_estimate(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_contract(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_employee_time_entries(uuid, text, text[], integer, boolean) TO anon, authenticated;

DO $$
BEGIN
  GRANT EXECUTE ON FUNCTION public.get_employee_shift_details(uuid, uuid) TO anon, authenticated;
EXCEPTION
  WHEN undefined_function THEN
    NULL;
END $$;

COMMENT ON FUNCTION public.get_public_company_profile(uuid) IS
  'Public branding/contact-card slice for one owner. No Stripe, personal phone, or tokens.';
COMMENT ON FUNCTION public.get_public_invoice(text) IS
  'Single non-draft invoice by payment_token or legacy UUID id.';
COMMENT ON FUNCTION public.get_employee_time_entries(uuid, text, text[], integer, boolean) IS
  'Returns one employee''s time entries after matching employee_id + phone digits.';
