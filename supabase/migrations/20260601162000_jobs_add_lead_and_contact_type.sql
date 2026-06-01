-- Add lead linkage and contact type to jobs.

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS contact_type text DEFAULT 'client';

COMMENT ON COLUMN public.jobs.lead_id IS
  'Lead linked to this job when the contact source is a lead.';

COMMENT ON COLUMN public.jobs.contact_type IS
  'Contact source for this job: client or lead.';

CREATE INDEX IF NOT EXISTS idx_jobs_lead_id
  ON public.jobs(lead_id)
  WHERE lead_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_jobs_contact_type
  ON public.jobs(contact_type);

ALTER TABLE public.jobs
  DROP CONSTRAINT IF EXISTS jobs_contact_type_check;

ALTER TABLE public.jobs
  ADD CONSTRAINT jobs_contact_type_check
  CHECK (contact_type IS NULL OR contact_type IN ('client', 'lead'));

UPDATE public.jobs
SET contact_type = CASE
  WHEN lead_id IS NOT NULL THEN 'lead'
  ELSE 'client'
END
WHERE contact_type IS NULL;
