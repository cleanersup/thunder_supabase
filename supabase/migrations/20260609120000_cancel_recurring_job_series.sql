-- Cancel an entire recurring job series in one transaction.
-- Disables per-row status email trigger during bulk updates, then sends a single email for the parent.

CREATE OR REPLACE FUNCTION public.cancel_recurring_job_series (p_job_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_job public.jobs%ROWTYPE;
  v_previous_status text;
  v_children_cancelled integer := 0;
BEGIN
  SELECT *
  INTO v_job
  FROM public.jobs
  WHERE id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job not found';
  END IF;

  IF v_uid IS NOT NULL AND v_job.user_id <> v_uid THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;

  IF v_job.parent_job_id IS NOT NULL THEN
    RAISE EXCEPTION 'Job % is not a recurring series parent', p_job_id;
  END IF;

  IF v_job.job_type <> 'recurring' THEN
    RAISE EXCEPTION 'Job % is not recurring', p_job_id;
  END IF;

  IF v_job.status = 'cancelled' THEN
    RETURN jsonb_build_object(
      'job_id', p_job_id,
      'children_cancelled', 0,
      'parent_cancelled', false,
      'message', 'Job already cancelled'
    );
  END IF;

  v_previous_status := v_job.status;

  -- Suppress per-row status emails while bulk-updating the series.
  ALTER TABLE public.jobs DISABLE TRIGGER on_job_status_change_send_email;

  BEGIN
    UPDATE public.jobs
    SET status = 'cancelled'
    WHERE parent_job_id = p_job_id
      AND status = 'scheduled';

    GET DIAGNOSTICS v_children_cancelled = ROW_COUNT;

    UPDATE public.jobs
    SET status = 'cancelled'
    WHERE id = p_job_id
      AND status IS DISTINCT FROM 'cancelled';

    ALTER TABLE public.jobs ENABLE TRIGGER on_job_status_change_send_email;
  EXCEPTION
    WHEN OTHERS THEN
      ALTER TABLE public.jobs ENABLE TRIGGER on_job_status_change_send_email;
      RAISE;
  END;

  -- One notification for the series cancellation (parent job).
  PERFORM public.dispatch_job_status_email(
    p_job_id,
    v_previous_status,
    'cancelled',
    'UPDATE'
  );

  RETURN jsonb_build_object(
    'job_id', p_job_id,
    'children_cancelled', v_children_cancelled,
    'parent_cancelled', true,
    'previous_status', v_previous_status
  );
END;
$$;

COMMENT ON FUNCTION public.cancel_recurring_job_series (uuid) IS
  'Cancels all scheduled child jobs and the recurring parent in one transaction. Sends a single status email for the parent.';

GRANT EXECUTE ON FUNCTION public.cancel_recurring_job_series (uuid) TO authenticated;
