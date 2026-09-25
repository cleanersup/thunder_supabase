-- Tasks only had due_date. Add a real window so two tasks with the same
-- title on the same slot can be rejected.

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS start_date date,
  ADD COLUMN IF NOT EXISTS end_date date,
  ADD COLUMN IF NOT EXISTS start_time time,
  ADD COLUMN IF NOT EXISTS end_time time;

COMMENT ON COLUMN public.tasks.start_date IS 'Optional first day of the task window.';
COMMENT ON COLUMN public.tasks.end_date   IS 'Optional last day of the task window.';
COMMENT ON COLUMN public.tasks.start_time IS 'Optional start time of day.';
COMMENT ON COLUMN public.tasks.end_time   IS 'Optional end time of day.';

CREATE OR REPLACE FUNCTION public.prevent_duplicate_task ()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Nothing to compare against if there is no schedule and no due date.
  IF NEW.start_date IS NULL
     AND NEW.start_time IS NULL
     AND NEW.end_date IS NULL
     AND NEW.end_time IS NULL
     AND NEW.due_date IS NULL THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.tasks t
    WHERE t.user_id = NEW.user_id
      AND t.id IS DISTINCT FROM NEW.id
      AND lower(btrim(t.title)) = lower(btrim(NEW.title))
      AND t.start_date IS NOT DISTINCT FROM NEW.start_date
      AND t.end_date   IS NOT DISTINCT FROM NEW.end_date
      AND t.start_time IS NOT DISTINCT FROM NEW.start_time
      AND t.end_time   IS NOT DISTINCT FROM NEW.end_time
      AND t.due_date   IS NOT DISTINCT FROM NEW.due_date
  ) THEN
    RAISE EXCEPTION 'A task with the same title and schedule already exists'
      USING ERRCODE = 'unique_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_prevent_duplicate_task ON public.tasks;
CREATE TRIGGER tr_prevent_duplicate_task
  BEFORE INSERT OR UPDATE OF title, start_date, end_date, start_time, end_time, due_date, user_id
  ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_duplicate_task ();
