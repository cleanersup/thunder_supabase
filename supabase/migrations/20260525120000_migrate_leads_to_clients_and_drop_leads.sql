-- One-time migration: move all leads into clients, rewire lead_id references, drop public.leads.
--
-- Prerequisites: deploy app changes that no longer read/write leads before or with this migration.
-- Preserves lead UUID as client.id when the email is not already a client (simplifies FK rewiring).
-- When email already exists on a client for the same merchant, maps to that existing client row.

-- ── 1) Mapping table (lead_id → client_id) ────────────────────────────────────

CREATE TABLE IF NOT EXISTS public._lead_to_client_migration (
  lead_id uuid PRIMARY KEY,
  client_id uuid NOT NULL
);

TRUNCATE public._lead_to_client_migration;

-- ── 2) Insert leads as clients (skip when same merchant already has that email) ─

INSERT INTO public.clients (
  id,
  user_id,
  full_name,
  company,
  phone,
  email,
  billing_street,
  billing_apt,
  billing_city,
  billing_state,
  billing_zip,
  service_street,
  service_apt,
  service_city,
  service_state,
  service_zip,
  client_type,
  contact_preference,
  instructions,
  status,
  created_at,
  updated_at
)
SELECT
  l.id,
  l.user_id,
  l.full_name,
  l.company_name,
  l.phone,
  l.email,
  l.address,
  l.apt_suite,
  l.city,
  l.state,
  l.zip_code,
  l.address,
  l.apt_suite,
  l.city,
  l.state,
  l.zip_code,
  'residential',
  'phone',
  NULLIF(
    trim(
      concat_ws(
        E'\n',
        NULLIF(trim(l.internal_notes), ''),
        CASE WHEN l.lead_source IS NOT NULL AND trim(l.lead_source) <> '' THEN
          'Lead source: ' || l.lead_source
        END,
        CASE WHEN l.service_interested IS NOT NULL AND trim(l.service_interested) <> '' THEN
          'Service interested: ' || l.service_interested
        END,
        CASE WHEN l.priority_level IS NOT NULL AND trim(l.priority_level) <> '' THEN
          'Priority: ' || l.priority_level
        END,
        CASE WHEN l.status IS NOT NULL AND trim(l.status) <> '' THEN
          'Lead status: ' || l.status
        END
      )
    ),
    ''
  ),
  'active',
  l.created_at,
  l.updated_at
FROM public.leads l
WHERE NOT EXISTS (
  SELECT 1
  FROM public.clients c
  WHERE c.user_id = l.user_id
    AND lower(trim(c.email)) = lower(trim(l.email))
);

-- ── 3) Build lead_id → client_id map ──────────────────────────────────────────

INSERT INTO public._lead_to_client_migration (lead_id, client_id)
SELECT
  l.id,
  c.id
FROM public.leads l
JOIN public.clients c
  ON c.user_id = l.user_id
 AND lower(trim(c.email)) = lower(trim(l.email))
ON CONFLICT (lead_id) DO NOTHING;

-- ── 4) Rewire walkthroughs ────────────────────────────────────────────────────

UPDATE public.walkthroughs w
SET
  client_id = COALESCE(w.client_id, m.client_id),
  walkthrough_type = 'client',
  lead_id = NULL
FROM public._lead_to_client_migration m
WHERE w.lead_id = m.lead_id;

-- Legacy rows where walkthrough_type = lead but lead_id pointed at a booking id
UPDATE public.walkthroughs w
SET
  client_id = b.client_id,
  walkthrough_type = 'client',
  lead_id = NULL
FROM public.bookings b
WHERE w.walkthrough_type = 'lead'
  AND w.lead_id IS NOT NULL
  AND w.client_id IS NULL
  AND b.id = w.lead_id
  AND b.client_id IS NOT NULL;

-- Remaining lead-type walkthroughs with orphan lead_id: clear type so CHECK still passes
UPDATE public.walkthroughs
SET
  walkthrough_type = 'client',
  lead_id = NULL
WHERE walkthrough_type = 'lead'
  AND lead_id IS NOT NULL
  AND client_id IS NULL;

UPDATE public.walkthroughs
SET walkthrough_type = 'client'
WHERE walkthrough_type = 'lead';

-- ── 5) Rewire estimates ─────────────────────────────────────────────────────

UPDATE public.estimates e
SET
  client_id = COALESCE(e.client_id, m.client_id),
  lead_id = NULL
FROM public._lead_to_client_migration m
WHERE e.lead_id = m.lead_id;

-- ── 6) Rewire bookings (requests) ─────────────────────────────────────────────

UPDATE public.bookings b
SET
  client_id = COALESCE(b.client_id, m.client_id),
  lead_id = NULL,
  contact_type = 'client'
FROM public._lead_to_client_migration m
WHERE b.lead_id = m.lead_id;

UPDATE public.bookings
SET contact_type = 'client'
WHERE contact_type = 'lead';

-- ── 7) Drop lead_id columns and leads table ───────────────────────────────────

ALTER TABLE public.estimates
  DROP CONSTRAINT IF EXISTS estimates_lead_id_fkey;

ALTER TABLE public.estimates
  DROP COLUMN IF EXISTS lead_id;

ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_lead_id_fkey;

ALTER TABLE public.bookings
  DROP COLUMN IF EXISTS lead_id;

ALTER TABLE public.walkthroughs
  DROP COLUMN IF EXISTS lead_id;

DROP TRIGGER IF EXISTS update_leads_updated_at ON public.leads;

DROP POLICY IF EXISTS "Users can view their own leads" ON public.leads;
DROP POLICY IF EXISTS "Users can create their own leads" ON public.leads;
DROP POLICY IF EXISTS "Users can update their own leads" ON public.leads;
DROP POLICY IF EXISTS "Users can delete their own leads" ON public.leads;
DROP POLICY IF EXISTS "Allow public read access to leads" ON public.leads;
DROP POLICY IF EXISTS "Anyone can create leads" ON public.leads;
DROP POLICY IF EXISTS "Anyone can update leads" ON public.leads;
DROP POLICY IF EXISTS "Anyone can delete leads" ON public.leads;

DROP TABLE IF EXISTS public.leads;

DROP TABLE IF EXISTS public._lead_to_client_migration;

COMMENT ON COLUMN public.bookings.contact_type IS 'Contact linked to the request; lead type removed — client only.';
