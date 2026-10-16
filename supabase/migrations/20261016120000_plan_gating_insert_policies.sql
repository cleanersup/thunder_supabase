-- Plan gating on the server (INSERT only).
--
-- The apps check the plan in the client before creating anything; nothing on
-- the server enforced it. This adds `has_plan_feature()` and one RESTRICTIVE
-- INSERT policy per gated table, so a user who skips the client check (devtools,
-- direct API call) cannot create rows for a feature their plan does not include.
--
-- Deliberate scope decisions:
--
--   * INSERT only, not UPDATE. Several owner actions are UPDATEs that must keep
--     working after a downgrade: booking_archive / booking_cancel / booking_restore,
--     and the request→estimate and walkthrough→estimate conversions
--     (finalize_booking_conversion / finalize_walkthrough_to_estimate_conversion,
--     both SECURITY INVOKER) update bookings / walkthroughs, which are Essential
--     tables, while creating an estimate is Basic.
--
--   * time_entries is NOT gated. AddServiceToRoute inserts time_entries when an
--     owner schedules employees on a route (Schedule = Essential); gating it as
--     Time Clock (Professional) would break route scheduling for Essential users.
--     Employee clock writes go through service-role edge functions anyway.
--
--   * Policies are RESTRICTIVE and TO authenticated. Existing permissive
--     ownership policies stay as they are (a plain permissive policy would be
--     OR-ed with them and gate nothing). anon (public booking / walkthrough
--     forms), service_role (edge functions, webhooks) and SECURITY DEFINER /
--     cron functions owned by postgres are not affected.
--
--   * has_plan_feature() is intentionally more lenient than the apps where they
--     disagree (gifted accounts, cancelled-until-expiry, billing grace): the
--     server is the backstop, it must never lock out someone the app lets in.

-- ─── 1) has_plan_feature(feature) ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.has_plan_feature (feature text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p            public.profiles%ROWTYPE;
  v_tier       text;
  v_trial_days int;
  v_trial_end  timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  -- profiles.id is its own uuid; the auth user is profiles.user_id.
  SELECT * INTO p FROM public.profiles WHERE user_id = auth.uid();
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Paid or manually granted plan. A future expiry wins over subscription_status
  -- (cancelled = active until expiry, inactive after BILLING_ISSUE keeps the
  -- store grace period) — same as useSupabaseSubscription in swift-slate.
  -- NULL / 'free' / legacy 'premium' never match and fall through to no access.
  IF p.plan_tier IN ('basic', 'essential', 'professional')
     AND (
       (p.subscription_expiry_date IS NOT NULL AND p.subscription_expiry_date > now())
       OR (p.subscription_expiry_date IS NULL AND p.subscription_status IN ('active', 'trial'))
     )
  THEN
    v_tier := p.plan_tier;
  END IF;

  -- Trial = Professional. 30 days for users created before 2025-12-16, 14 after,
  -- counted from trial_start_date (written on first load) or created_at.
  v_trial_days := CASE WHEN p.created_at < '2025-12-16'::timestamptz THEN 30 ELSE 14 END;
  v_trial_end  := COALESCE(p.trial_start_date, p.created_at) + make_interval(days => v_trial_days);
  IF v_trial_end IS NOT NULL AND now() < v_trial_end THEN
    v_tier := 'professional';
  END IF;

  RETURN CASE v_tier
    WHEN 'professional' THEN true
    WHEN 'essential'    THEN feature IN ('estimates', 'invoices', 'employee', 'requests',
                                         'walkthroughs', 'jobs', 'schedule')
    WHEN 'basic'        THEN feature IN ('estimates', 'invoices', 'employee')
    ELSE false
  END;
END;
$$;

COMMENT ON FUNCTION public.has_plan_feature (text) IS
  'True when the calling user''s plan (or active trial) includes the feature. Mirrors src/config/planFeatures.ts in swift-slate.';

REVOKE ALL ON FUNCTION public.has_plan_feature (text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_plan_feature (text) TO authenticated;

-- ─── 2) require_plan_feature(feature) — used by the policies ──────────────────
-- Raises instead of returning false so the client gets a recognizable error
-- (hint = PLAN_UPGRADE_REQUIRED, details = feature) instead of a bare 42501.

CREATE OR REPLACE FUNCTION public.require_plan_feature (feature text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
BEGIN
  IF public.has_plan_feature(feature) THEN
    RETURN true;
  END IF;
  RAISE EXCEPTION 'Your current plan does not include this feature. Upgrade your plan to continue.'
    USING ERRCODE = 'P0001',
          DETAIL  = feature,
          HINT    = 'PLAN_UPGRADE_REQUIRED';
END;
$$;

REVOKE ALL ON FUNCTION public.require_plan_feature (text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.require_plan_feature (text) TO authenticated;

-- ─── 3) Restrictive INSERT policy per gated table ─────────────────────────────
-- `(SELECT …)` makes Postgres evaluate the check once per statement, not per
-- row (recurring job generation inserts many rows at once).
-- Tables that do not exist, or do not have RLS enabled, are skipped with a
-- NOTICE: enabling RLS here on a table without permissive policies would block
-- every write to it.

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('estimates',                    'estimates'),
      ('quick_quotes',                 'estimates'),
      ('invoices',                     'invoices'),
      ('employees',                    'employee'),
      ('bookings',                     'requests'),
      ('booking_forms',                'requests'),
      ('walkthroughs',                 'walkthroughs'),
      ('residential_walkthrough_data', 'walkthroughs'),
      ('commercial_walkthrough_data',  'walkthroughs'),
      ('jobs',                         'jobs'),
      ('routes',                       'schedule'),
      ('route_appointments',           'schedule'),
      ('tasks',                        'tasks'),
      ('paid_periods',                 'time_clock')
    ) AS t (table_name, feature)
  LOOP
    IF to_regclass(format('public.%I', r.table_name)) IS NULL THEN
      RAISE NOTICE 'plan gating: table public.% not found, skipped', r.table_name;
      CONTINUE;
    END IF;

    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass(format('public.%I', r.table_name))) THEN
      RAISE NOTICE 'plan gating: RLS is disabled on public.%, skipped', r.table_name;
      CONTINUE;
    END IF;

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'plan_gate_insert', r.table_name);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated '
      'WITH CHECK ((SELECT public.require_plan_feature(%L)))',
      'plan_gate_insert', r.table_name, r.feature
    );
  END LOOP;
END;
$$;

-- ─── 4) Close update_subscription() ──────────────────────────────────────────
-- SECURITY DEFINER + EXECUTE for authenticated + caller-supplied p_user_id: any
-- signed-in user could set any account's plan. No app calls it (plan writes
-- come from the RevenueCat webhook and the mobile client).

DO $$
BEGIN
  IF to_regprocedure('public.update_subscription(uuid, boolean, text, text, timestamptz)') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.update_subscription (uuid, boolean, text, text, timestamptz)
      FROM PUBLIC, anon, authenticated;
  END IF;
END;
$$;
