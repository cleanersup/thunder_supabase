-- Normalize jobs.assigned_employees to a JSONB array of employee UUID strings.
-- Supports legacy rows stored as [{ "id": "...", "name": "..." }, ...].

CREATE OR REPLACE FUNCTION public.normalize_job_assigned_employees_jsonb (p_raw jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    jsonb_agg(to_jsonb(emp_id) ORDER BY emp_id),
    '[]'::jsonb
  )
  FROM (
    SELECT DISTINCT
      CASE
        WHEN jsonb_typeof(elem) = 'string' THEN NULLIF(elem #>> '{}', '')
        WHEN jsonb_typeof(elem) = 'object' THEN NULLIF(trim(elem->>'id'), '')
        ELSE NULL
      END AS emp_id
    FROM jsonb_array_elements(COALESCE(p_raw, '[]'::jsonb)) AS elem
  ) normalized
  WHERE emp_id IS NOT NULL;
$$;

COMMENT ON FUNCTION public.normalize_job_assigned_employees_jsonb (jsonb) IS
  'Coerces jobs.assigned_employees to a deduplicated JSONB array of employee id strings.';

CREATE OR REPLACE FUNCTION public.normalize_job_assigned_employees_row ()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.assigned_employees := public.normalize_job_assigned_employees_jsonb(NEW.assigned_employees);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_normalize_job_assigned_employees ON public.jobs;
CREATE TRIGGER tr_normalize_job_assigned_employees
  BEFORE INSERT OR UPDATE OF assigned_employees ON public.jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.normalize_job_assigned_employees_row ();

-- Backfill existing rows (objects → string ids).
UPDATE public.jobs j
SET assigned_employees = public.normalize_job_assigned_employees_jsonb(j.assigned_employees)
WHERE j.assigned_employees IS DISTINCT FROM public.normalize_job_assigned_employees_jsonb(j.assigned_employees);

-- Keep mirrored schedule rows in sync after backfill.
UPDATE public.route_appointments ra
SET assigned_employees = public.normalize_job_assigned_employees_jsonb(ra.assigned_employees)
WHERE ra.job_id IS NOT NULL
  AND ra.assigned_employees IS DISTINCT FROM public.normalize_job_assigned_employees_jsonb(ra.assigned_employees);
