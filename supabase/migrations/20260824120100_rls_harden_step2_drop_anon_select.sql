-- Step 2: drop open anon SELECT policies.
-- Apply AFTER public pages (dashboard, swift-slate, thunder-web-version) call the
-- RPCs from 20260824120000. Owner + portal policies are kept.

-- ─── profiles ─────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Anyone can view company branding" ON public.profiles;
DROP POLICY IF EXISTS "Anyone can view profiles" ON public.profiles;

-- Recreate owner SELECT if a previous open policy replaced it
DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;
CREATE POLICY "Users can view their own profile"
  ON public.profiles
  FOR SELECT
  USING (auth.uid() = user_id);

-- Portal merchant branding policy is left in place
-- ("Portal clients select merchant profile for branding").

-- ─── invoices ─────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Allow public read access to invoices" ON public.invoices;

-- ─── estimates ────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Anyone can view estimates with valid share token"
  ON public.estimates;

-- ─── contracts ────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Allow public read access to contracts" ON public.contracts;

-- ─── booking_forms ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Anyone can view booking forms for public pages"
  ON public.booking_forms;
