-- Ensure job-site coordinates exist for dashboard create/update and employee geofence.
-- Idempotent: safe if 20260701120000 already ran. Reloads PostgREST so PGRST204 goes away.

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS site_latitude          numeric(10, 7),
  ADD COLUMN IF NOT EXISTS site_longitude         numeric(10, 7),
  ADD COLUMN IF NOT EXISTS geofence_radius_meters integer NOT NULL DEFAULT 200;

NOTIFY pgrst, 'reload schema';
