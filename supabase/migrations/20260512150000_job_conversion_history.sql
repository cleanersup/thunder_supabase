-- Conversion history: Estimate/Walkthrough <-> Job
-- Adds relational traceability and atomic RPCs to finalize conversion to job.

-- 1) Relationship columns
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS estimate_id uuid REFERENCES public.estimates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS walkthrough_id uuid REFERENCES public.walkthroughs(id) ON DELETE SET NULL;

ALTER TABLE public.estimates
  ADD COLUMN IF NOT EXISTS job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL;

ALTER TABLE public.walkthroughs
  ADD COLUMN IF NOT EXISTS job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL;

-- A job can come from at most one source record.
ALTER TABLE public.jobs
  DROP CONSTRAINT IF EXISTS jobs_single_source_check;

ALTER TABLE public.jobs
  ADD CONSTRAINT jobs_single_source_check
  CHECK (num_nonnulls(estimate_id, walkthrough_id) <= 1);

CREATE UNIQUE INDEX IF NOT EXISTS uq_jobs_estimate_id
ON public.jobs(estimate_id)
WHERE estimate_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_jobs_walkthrough_id
ON public.jobs(walkthrough_id)
WHERE walkthrough_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_estimates_job_id
ON public.estimates(job_id)
WHERE job_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_walkthroughs_job_id
ON public.walkthroughs(job_id)
WHERE job_id IS NOT NULL;

COMMENT ON COLUMN public.jobs.estimate_id IS 'Source estimate when this job was converted from an estimate.';
COMMENT ON COLUMN public.jobs.walkthrough_id IS 'Source walkthrough when this job was converted from a walkthrough.';
COMMENT ON COLUMN public.estimates.job_id IS 'Job created/linked from this estimate conversion.';
COMMENT ON COLUMN public.walkthroughs.job_id IS 'Job created/linked from this walkthrough conversion.';

-- 2) Ownership guards for relations
CREATE OR REPLACE FUNCTION public.enforce_estimate_job_same_owner ()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.job_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.jobs j
      WHERE j.id = NEW.job_id
        AND j.user_id = NEW.user_id
    ) THEN
      RAISE EXCEPTION 'estimates.job_id must reference a job owned by the same user';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_enforce_estimate_job_owner ON public.estimates;
CREATE TRIGGER tr_enforce_estimate_job_owner
  BEFORE INSERT OR UPDATE OF job_id, user_id ON public.estimates
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_estimate_job_same_owner ();

CREATE OR REPLACE FUNCTION public.enforce_walkthrough_job_same_owner ()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.job_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.jobs j
      WHERE j.id = NEW.job_id
        AND j.user_id = NEW.user_id
    ) THEN
      RAISE EXCEPTION 'walkthroughs.job_id must reference a job owned by the same user';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_enforce_walkthrough_job_owner ON public.walkthroughs;
CREATE TRIGGER tr_enforce_walkthrough_job_owner
  BEFORE INSERT OR UPDATE OF job_id, user_id ON public.walkthroughs
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_walkthrough_job_same_owner ();

CREATE OR REPLACE FUNCTION public.enforce_job_source_same_owner ()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.estimate_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.estimates e
      WHERE e.id = NEW.estimate_id
        AND e.user_id = NEW.user_id
    ) THEN
      RAISE EXCEPTION 'jobs.estimate_id must reference an estimate owned by the same user';
    END IF;
  END IF;

  IF NEW.walkthrough_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.walkthroughs w
      WHERE w.id = NEW.walkthrough_id
        AND w.user_id = NEW.user_id
    ) THEN
      RAISE EXCEPTION 'jobs.walkthrough_id must reference a walkthrough owned by the same user';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_enforce_job_source_owner ON public.jobs;
CREATE TRIGGER tr_enforce_job_source_owner
  BEFORE INSERT OR UPDATE OF estimate_id, walkthrough_id, user_id ON public.jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_job_source_same_owner ();

-- 3) Atomic RPC: estimate -> job conversion
CREATE OR REPLACE FUNCTION public.finalize_estimate_to_job_conversion (
  p_estimate_id uuid,
  p_job_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_est record;
  v_job record;
  v_rows int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_est
  FROM public.estimates
  WHERE id = p_estimate_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Estimate not found';
  END IF;
  IF v_est.user_id <> v_uid THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  IF v_est.job_id IS NOT NULL AND v_est.job_id IS DISTINCT FROM p_job_id THEN
    RAISE EXCEPTION 'Estimate is already linked to another job';
  END IF;

  SELECT * INTO v_job
  FROM public.jobs
  WHERE id = p_job_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job not found';
  END IF;
  IF v_job.user_id <> v_uid THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  IF v_job.estimate_id IS NOT NULL AND v_job.estimate_id IS DISTINCT FROM p_estimate_id THEN
    RAISE EXCEPTION 'Job is already linked to another estimate';
  END IF;
  IF v_job.walkthrough_id IS NOT NULL THEN
    RAISE EXCEPTION 'Job is already linked to a walkthrough; only one source is allowed';
  END IF;

  UPDATE public.jobs
  SET estimate_id = p_estimate_id
  WHERE id = p_job_id
    AND user_id = v_uid;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'Failed to link job to estimate';
  END IF;

  UPDATE public.estimates
  SET
    job_id = p_job_id,
    status = 'Converted',
    is_draft = false
  WHERE id = p_estimate_id
    AND user_id = v_uid;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'Failed to mark estimate as converted';
  END IF;

  RETURN jsonb_build_object(
    'job_id', p_job_id,
    'estimate_id', p_estimate_id,
    'job', (SELECT to_jsonb(j.*) FROM public.jobs j WHERE j.id = p_job_id),
    'estimate', (SELECT to_jsonb(e.*) FROM public.estimates e WHERE e.id = p_estimate_id)
  );
END;
$$;

COMMENT ON FUNCTION public.finalize_estimate_to_job_conversion (uuid, uuid) IS
  'Atomic conversion: links estimate to job both ways and marks estimate status as Converted.';

GRANT EXECUTE ON FUNCTION public.finalize_estimate_to_job_conversion (uuid, uuid) TO authenticated;

-- 4) Atomic RPC: walkthrough -> job conversion
CREATE OR REPLACE FUNCTION public.finalize_walkthrough_to_job_conversion (
  p_walkthrough_id uuid,
  p_job_id uuid,
  p_allowed_walkthrough_statuses text[] DEFAULT ARRAY['Draft', 'Scheduled', 'Started', 'Completed']::text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_wt record;
  v_job record;
  v_rows int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_wt
  FROM public.walkthroughs
  WHERE id = p_walkthrough_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Walkthrough not found';
  END IF;
  IF v_wt.user_id <> v_uid THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  IF NOT (v_wt.status = ANY (p_allowed_walkthrough_statuses)) THEN
    RAISE EXCEPTION 'Walkthrough status % does not allow conversion (allowed: %)', v_wt.status, p_allowed_walkthrough_statuses;
  END IF;
  IF v_wt.job_id IS NOT NULL AND v_wt.job_id IS DISTINCT FROM p_job_id THEN
    RAISE EXCEPTION 'Walkthrough is already linked to another job';
  END IF;

  SELECT * INTO v_job
  FROM public.jobs
  WHERE id = p_job_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job not found';
  END IF;
  IF v_job.user_id <> v_uid THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  IF v_job.walkthrough_id IS NOT NULL AND v_job.walkthrough_id IS DISTINCT FROM p_walkthrough_id THEN
    RAISE EXCEPTION 'Job is already linked to another walkthrough';
  END IF;
  IF v_job.estimate_id IS NOT NULL THEN
    RAISE EXCEPTION 'Job is already linked to an estimate; only one source is allowed';
  END IF;

  UPDATE public.jobs
  SET walkthrough_id = p_walkthrough_id
  WHERE id = p_job_id
    AND user_id = v_uid;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'Failed to link job to walkthrough';
  END IF;

  UPDATE public.walkthroughs
  SET
    job_id = p_job_id,
    status = 'Converted'
  WHERE id = p_walkthrough_id
    AND user_id = v_uid;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'Failed to mark walkthrough as converted';
  END IF;

  RETURN jsonb_build_object(
    'job_id', p_job_id,
    'walkthrough_id', p_walkthrough_id,
    'job', (SELECT to_jsonb(j.*) FROM public.jobs j WHERE j.id = p_job_id),
    'walkthrough', (SELECT to_jsonb(w.*) FROM public.walkthroughs w WHERE w.id = p_walkthrough_id)
  );
END;
$$;

COMMENT ON FUNCTION public.finalize_walkthrough_to_job_conversion (uuid, uuid, text[]) IS
  'Atomic conversion: links walkthrough to job both ways and marks walkthrough status as Converted. Third arg controls allowed source statuses.';

GRANT EXECUTE ON FUNCTION public.finalize_walkthrough_to_job_conversion (uuid, uuid, text[]) TO authenticated;
