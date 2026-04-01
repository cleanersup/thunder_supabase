-- Link contracts to CRM clients for edit prefill (recipient_id + type).

ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS recipient_id uuid REFERENCES public.clients(id) ON DELETE SET NULL;

ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS recipient_type text DEFAULT 'client';

COMMENT ON COLUMN public.contracts.recipient_id IS 'Optional FK to public.clients for contracts created from the CRM client picker.';
COMMENT ON COLUMN public.contracts.recipient_type IS 'Recipient kind; dashboard uses client.';
