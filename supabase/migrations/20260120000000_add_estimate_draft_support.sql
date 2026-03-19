-- Add draft support fields to estimates table
-- This allows saving incomplete estimates and recovering them later

-- Add is_draft flag to indicate if estimate is a draft
ALTER TABLE public.estimates
ADD COLUMN IF NOT EXISTS is_draft BOOLEAN DEFAULT FALSE;

-- Add current_step to track where user left off
ALTER TABLE public.estimates
ADD COLUMN IF NOT EXISTS current_step INTEGER DEFAULT 0;

-- Add draft_data to store temporary form data for incomplete steps
-- This stores all the wizard state that hasn't been finalized yet
ALTER TABLE public.estimates
ADD COLUMN IF NOT EXISTS draft_data JSONB DEFAULT NULL;

-- Add client_id and lead_id references for drafts
-- (regular estimates store denormalized client data, but drafts need the reference)
ALTER TABLE public.estimates
ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL;

ALTER TABLE public.estimates
ADD COLUMN IF NOT EXISTS lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL;

-- Create index for faster draft queries
CREATE INDEX IF NOT EXISTS idx_estimates_user_draft
ON public.estimates(user_id, is_draft)
WHERE is_draft = true;

-- Create index for service type filtering
CREATE INDEX IF NOT EXISTS idx_estimates_service_type
ON public.estimates(user_id, service_type);

-- Comment on columns for documentation
COMMENT ON COLUMN public.estimates.is_draft IS 'Indicates if this estimate is a draft (incomplete)';
COMMENT ON COLUMN public.estimates.current_step IS 'The wizard step where the user left off (0-indexed)';
COMMENT ON COLUMN public.estimates.draft_data IS 'JSON object containing all wizard state for incomplete estimates';
COMMENT ON COLUMN public.estimates.client_id IS 'Reference to client for draft estimates';
COMMENT ON COLUMN public.estimates.lead_id IS 'Reference to lead for draft estimates';
