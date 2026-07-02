-- Add country column to client_properties.
-- This column was present on staging but was never committed as a migration,
-- causing a PGRST204 "column not found" error on production.

ALTER TABLE public.client_properties
  ADD COLUMN IF NOT EXISTS country text DEFAULT 'us';

COMMENT ON COLUMN public.client_properties.country IS
  'ISO country code for the property address (e.g. us, ca, mx). Defaults to us.';
