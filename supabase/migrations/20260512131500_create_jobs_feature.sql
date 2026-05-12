-- Jobs feature: dedicated table + lifecycle + status change notifications
-- This table is separate from route_appointments and stores the new Jobs form payload.

CREATE EXTENSION IF NOT EXISTS pg_net;

-- 1) Core table
CREATE TABLE IF NOT EXISTS public.jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  job_number text UNIQUE,

  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  client_name text,
  client_email text,
  client_phone text,

  property_street text,
  property_apt text,
  property_city text,
  property_state text,
  property_zip text,

  assigned_employees jsonb NOT NULL DEFAULT '[]'::jsonb,

  service_type text NOT NULL,
  job_type text NOT NULL DEFAULT 'one_time' CHECK (job_type IN ('one_time', 'recurring')),
  recurring_frequency text,
  recurring_duration text,
  recurring_duration_unit text DEFAULT 'months',
  selected_week_days jsonb DEFAULT '[]'::jsonb,

  scheduled_date date NOT NULL,
  start_time time,
  end_time time,

  line_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  service_details text NOT NULL,
  internal_notes text,

  -- Financials
  subtotal numeric(12,2) NOT NULL DEFAULT 0,
  discount_type text NOT NULL DEFAULT 'amount' CHECK (discount_type IN ('amount', 'percent')),
  discount_value numeric(12,2) NOT NULL DEFAULT 0,
  discount_amount numeric(12,2) NOT NULL DEFAULT 0,
  tax_type text NOT NULL DEFAULT 'percent' CHECK (tax_type IN ('amount', 'percent')),
  tax_value numeric(12,2) NOT NULL DEFAULT 0,
  tax_amount numeric(12,2) NOT NULL DEFAULT 0,
  total_amount numeric(12,2) NOT NULL DEFAULT 0,

  deposit_required boolean NOT NULL DEFAULT false,
  deposit_type text NOT NULL DEFAULT 'amount' CHECK (deposit_type IN ('amount', 'percent')),
  deposit_value numeric(12,2) NOT NULL DEFAULT 0,
  deposit_amount numeric(12,2) NOT NULL DEFAULT 0,
  amount_paid numeric(12,2) NOT NULL DEFAULT 0,
  balance_due numeric(12,2) NOT NULL DEFAULT 0,
  payment_status text NOT NULL DEFAULT 'no_deposit_required' CHECK (payment_status IN (
    'no_deposit_required',
    'pending_deposit',
    'deposit_paid',
    'balance_due',
    'payment_completed'
  )),

  status text NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft',
    'upcoming',
    'today',
    'ongoing',
    'missed',
    'completed',
    'cancelled'
  )),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.jobs IS
  'Dedicated Jobs table for the new Jobs feature (form payload, financials, and lifecycle).';

COMMENT ON COLUMN public.jobs.status IS
  'Lifecycle: draft -> upcoming -> today -> ongoing -> completed; overdue non-completed jobs become missed; cancel from active states.';

CREATE INDEX IF NOT EXISTS idx_jobs_user_status ON public.jobs(user_id, status);
CREATE INDEX IF NOT EXISTS idx_jobs_scheduled_date ON public.jobs(scheduled_date);
CREATE INDEX IF NOT EXISTS idx_jobs_client_id ON public.jobs(client_id) WHERE client_id IS NOT NULL;

-- 2) RLS
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can create their own jobs" ON public.jobs;
CREATE POLICY "Users can create their own jobs"
ON public.jobs
FOR INSERT
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view their own jobs" ON public.jobs;
CREATE POLICY "Users can view their own jobs"
ON public.jobs
FOR SELECT
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own jobs" ON public.jobs;
CREATE POLICY "Users can update their own jobs"
ON public.jobs
FOR UPDATE
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own jobs" ON public.jobs;
CREATE POLICY "Users can delete their own jobs"
ON public.jobs
FOR DELETE
USING (auth.uid() = user_id);

-- 3) Job number generator
CREATE SEQUENCE IF NOT EXISTS public.jobs_job_number_seq START 1;

CREATE OR REPLACE FUNCTION public.assign_job_number ()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.job_number IS NULL OR NEW.job_number = '' THEN
    NEW.job_number := 'J-' || LPAD(nextval('public.jobs_job_number_seq')::text, 4, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_assign_job_number ON public.jobs;
CREATE TRIGGER tr_assign_job_number
  BEFORE INSERT ON public.jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.assign_job_number ();

-- 4) Financial calculator
CREATE OR REPLACE FUNCTION public.compute_job_financials ()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_subtotal numeric(12,2) := 0;
  v_discount numeric(12,2) := 0;
  v_tax_base numeric(12,2) := 0;
  v_tax numeric(12,2) := 0;
  v_total numeric(12,2) := 0;
  v_deposit numeric(12,2) := 0;
BEGIN
  -- Optional subtotal from line_items if provided and subtotal left as 0.
  IF jsonb_typeof(NEW.line_items) = 'array' AND COALESCE(NEW.subtotal, 0) = 0 THEN
    SELECT
      COALESCE(SUM(
        COALESCE(NULLIF(item->>'quantity', '')::numeric, 0)
        * COALESCE(NULLIF(item->>'unit_price', '')::numeric, 0)
      ), 0)
    INTO v_subtotal
    FROM jsonb_array_elements(NEW.line_items) item;
  ELSE
    v_subtotal := COALESCE(NEW.subtotal, 0);
  END IF;

  IF NEW.discount_type = 'percent' THEN
    v_discount := ROUND(v_subtotal * COALESCE(NEW.discount_value, 0) / 100.0, 2);
  ELSE
    v_discount := COALESCE(NEW.discount_value, 0);
  END IF;

  v_tax_base := GREATEST(v_subtotal - v_discount, 0);

  IF NEW.tax_type = 'percent' THEN
    v_tax := ROUND(v_tax_base * COALESCE(NEW.tax_value, 0) / 100.0, 2);
  ELSE
    v_tax := COALESCE(NEW.tax_value, 0);
  END IF;

  v_total := ROUND(v_tax_base + v_tax, 2);

  IF COALESCE(NEW.deposit_required, false) THEN
    IF NEW.deposit_type = 'percent' THEN
      v_deposit := ROUND(v_total * COALESCE(NEW.deposit_value, 0) / 100.0, 2);
    ELSE
      v_deposit := COALESCE(NEW.deposit_value, 0);
    END IF;
  ELSE
    v_deposit := 0;
  END IF;

  NEW.subtotal := ROUND(v_subtotal, 2);
  NEW.discount_amount := ROUND(v_discount, 2);
  NEW.tax_amount := ROUND(v_tax, 2);
  NEW.total_amount := ROUND(v_total, 2);
  NEW.deposit_amount := ROUND(v_deposit, 2);
  NEW.balance_due := ROUND(GREATEST(v_total - COALESCE(NEW.amount_paid, 0), 0), 2);

  IF COALESCE(NEW.amount_paid, 0) >= v_total AND v_total > 0 THEN
    NEW.payment_status := 'payment_completed';
  ELSIF COALESCE(NEW.deposit_required, false) = false THEN
    IF COALESCE(NEW.amount_paid, 0) > 0 THEN
      NEW.payment_status := 'balance_due';
    ELSE
      NEW.payment_status := 'no_deposit_required';
    END IF;
  ELSIF COALESCE(NEW.amount_paid, 0) < v_deposit THEN
    NEW.payment_status := 'pending_deposit';
  ELSIF COALESCE(NEW.amount_paid, 0) >= v_deposit AND COALESCE(NEW.amount_paid, 0) < v_total THEN
    NEW.payment_status := 'deposit_paid';
  ELSE
    NEW.payment_status := 'balance_due';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_compute_job_financials ON public.jobs;
CREATE TRIGGER tr_compute_job_financials
  BEFORE INSERT OR UPDATE OF line_items, subtotal, discount_type, discount_value, tax_type, tax_value, deposit_required, deposit_type, deposit_value, amount_paid
  ON public.jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.compute_job_financials ();

-- 5) Temporal status helpers + normalizer
CREATE OR REPLACE FUNCTION public.derive_job_temporal_status (p_date date)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
BEGIN
  IF p_date > CURRENT_DATE THEN
    RETURN 'upcoming';
  ELSIF p_date = CURRENT_DATE THEN
    RETURN 'today';
  END IF;
  RETURN 'missed';
END;
$$;

CREATE OR REPLACE FUNCTION public.normalize_job_status ()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.status := lower(COALESCE(NULLIF(trim(NEW.status), ''), 'draft'));
  IF NEW.status = 'canceled' THEN
    NEW.status := 'cancelled';
  END IF;

  -- For temporal states, always derive from scheduled_date.
  IF NEW.status IN ('upcoming', 'today', 'missed') THEN
    NEW.status := public.derive_job_temporal_status(NEW.scheduled_date);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_normalize_job_status ON public.jobs;
CREATE TRIGGER tr_normalize_job_status
  BEFORE INSERT OR UPDATE OF status, scheduled_date
  ON public.jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.normalize_job_status ();

CREATE OR REPLACE FUNCTION public.refresh_job_temporal_statuses ()
RETURNS integer
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_rows integer;
BEGIN
  UPDATE public.jobs j
  SET status = public.derive_job_temporal_status(j.scheduled_date)
  WHERE j.status IN ('upcoming', 'today', 'missed');

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$;

-- 6) Email trigger on status changes
CREATE OR REPLACE FUNCTION public.notify_job_status_change_send_email ()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  request_id bigint;
  function_url text;
BEGIN
  function_url := coalesce(nullif(current_setting('app.settings.supabase_url', TRUE), ''), 'https://euydrdzayvjahstvmwoj.supabase.co')
    || '/functions/v1/send-job-status-emails';

  SELECT
    net.http_post(
      url := function_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || coalesce(nullif(current_setting('app.settings.service_role_key', TRUE), ''), '')
      ),
      body := jsonb_build_object(
        'jobId', NEW.id::text,
        'previousStatus', OLD.status,
        'newStatus', NEW.status
      )
    )
  INTO request_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_job_status_change_send_email ON public.jobs;
CREATE TRIGGER on_job_status_change_send_email
  AFTER UPDATE OF status ON public.jobs
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.notify_job_status_change_send_email ();

COMMENT ON FUNCTION public.notify_job_status_change_send_email () IS
  'Queues send-job-status-emails after successful job status updates.';

-- 7) Keep updated_at fresh
DROP TRIGGER IF EXISTS update_jobs_updated_at ON public.jobs;
CREATE TRIGGER update_jobs_updated_at
  BEFORE UPDATE ON public.jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- 8) Optional cron refresh for temporal states
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule('refresh-jobs-temporal-status');
    EXCEPTION
      WHEN others THEN
        NULL;
    END;

    PERFORM cron.schedule(
      'refresh-jobs-temporal-status',
      '*/30 * * * *',
      'SELECT public.refresh_job_temporal_statuses();'
    );
  END IF;
END;
$$;
