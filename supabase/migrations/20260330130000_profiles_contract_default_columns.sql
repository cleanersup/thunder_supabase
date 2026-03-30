-- Contract wizard "Save as Default" (thunder-web-version): persists copy + clauses on profiles.
-- Same columns as thunder-web-version/supabase/migrations 20260320182122 … 20260320202824.
-- RLS: existing "Users can update their own profile" (auth.uid() = user_id) covers these fields.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS company_description text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS why_choose_us text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS our_services text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS service_coverage text DEFAULT NULL;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS clause_scope_of_work text,
  ADD COLUMN IF NOT EXISTS clause_purpose_of_agreement text,
  ADD COLUMN IF NOT EXISTS clause_price_and_payment text;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS clause_cancellation_policy text,
  ADD COLUMN IF NOT EXISTS clause_no_refund text,
  ADD COLUMN IF NOT EXISTS clause_non_compete text,
  ADD COLUMN IF NOT EXISTS clause_anti_harassment text,
  ADD COLUMN IF NOT EXISTS clause_liability_insurance text,
  ADD COLUMN IF NOT EXISTS clause_confidentiality text;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS custom_clauses jsonb DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.profiles.company_description IS 'Default Who we are text for new contracts (Save as Default).';
COMMENT ON COLUMN public.profiles.why_choose_us IS 'Default Why choose us text for new contracts.';
COMMENT ON COLUMN public.profiles.our_services IS 'Default Our services text for new contracts.';
COMMENT ON COLUMN public.profiles.service_coverage IS 'Default service coverage text for new contracts.';
COMMENT ON COLUMN public.profiles.custom_clauses IS 'Default custom contract policies as JSON array of {key, title, content}.';
