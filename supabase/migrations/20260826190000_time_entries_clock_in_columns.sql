-- Production is missing July time-clock columns that general clock-in writes
-- even when there is no job: time_entries.job_id, time_entries.event_time,
-- and time_entry_action_log (Crew always sends client_action_id).
-- Idempotent — staging will skip existing objects.

ALTER TABLE public.time_entries
  ADD COLUMN IF NOT EXISTS event_time timestamptz,
  ADD COLUMN IF NOT EXISTS job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_time_entries_job_id
  ON public.time_entries (job_id)
  WHERE job_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.time_entry_action_log (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_action_id text        NOT NULL,
  time_entry_id    uuid        NOT NULL REFERENCES public.time_entries(id) ON DELETE CASCADE,
  employee_id      uuid        NOT NULL,
  action           text        NOT NULL CHECK (action IN ('clock_in', 'clock_out', 'break_start', 'break_end')),
  event_time       timestamptz NOT NULL DEFAULT now(),
  server_time      timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_action_id)
);

CREATE INDEX IF NOT EXISTS idx_teal_employee_id   ON public.time_entry_action_log (employee_id);
CREATE INDEX IF NOT EXISTS idx_teal_time_entry_id ON public.time_entry_action_log (time_entry_id);

ALTER TABLE public.time_entry_action_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners can read their action log" ON public.time_entry_action_log;
CREATE POLICY "Owners can read their action log"
  ON public.time_entry_action_log FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.time_entries te
      WHERE te.id = time_entry_action_log.time_entry_id
        AND te.user_id = auth.uid()
    )
  );

NOTIFY pgrst, 'reload schema';
