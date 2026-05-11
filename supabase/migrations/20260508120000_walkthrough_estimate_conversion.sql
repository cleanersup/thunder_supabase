-- Walkthrough ↔ Estimate conversion lifecycle (diagram-aligned)
-- - estimates.walkthrough_id: traceable link from estimate to source walkthrough
-- - walkthrough statuses: Draft, Scheduled, Started, Completed, Converted, Cancelled
-- - Legacy API values estimate_sent / Pending are normalized to Converted / Started before CHECK
-- - Booking → Walkthrough → Estimate: booking enforcement allows same booking on estimate when
--   estimates.walkthrough_id matches the walkthrough that owns booking_id
-- - RPC: finalize_walkthrough_to_estimate_conversion

-- ─── 1. estimates.walkthrough_id ────────────────────────────────────────────

ALTER TABLE public.estimates
  ADD COLUMN IF NOT EXISTS walkthrough_id uuid REFERENCES public.walkthroughs (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_estimates_walkthrough_id ON public.estimates (walkthrough_id)
  WHERE walkthrough_id IS NOT NULL;

COMMENT ON COLUMN public.estimates.walkthrough_id IS 'Source walkthrough when this estimate was created from a walkthrough conversion; NULL if not from a walkthrough.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_estimates_walkthrough_id
  ON public.estimates (walkthrough_id)
  WHERE walkthrough_id IS NOT NULL;

-- ─── 2. Same-owner: estimates.walkthrough_id ────────────────────────────────

CREATE OR REPLACE FUNCTION public.enforce_estimate_walkthrough_same_owner ()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path = public
  AS $$
BEGIN
  IF NEW.walkthrough_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT
        1
      FROM
        public.walkthroughs w
      WHERE
        w.id = NEW.walkthrough_id
        AND w.user_id = NEW.user_id) THEN
      RAISE EXCEPTION 'estimates.walkthrough_id must reference a walkthrough owned by the same user';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_enforce_estimate_walkthrough_owner ON public.estimates;

CREATE TRIGGER tr_enforce_estimate_walkthrough_owner
  BEFORE INSERT OR UPDATE OF walkthrough_id, user_id ON public.estimates
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_estimate_walkthrough_same_owner ();

-- ─── 3. Walkthrough timestamps + legacy status normalization (before CHECK) ─

CREATE OR REPLACE FUNCTION public.set_walkthrough_completed_at ()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path = public
  AS $$
BEGIN
  -- Old clients may still send these; store canonical diagram statuses.
  IF NEW.status = 'estimate_sent' THEN
    NEW.status := 'Converted';
  ELSIF NEW.status = 'Pending' THEN
    NEW.status := 'Started';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'Completed' AND NEW.completed_at IS NULL THEN
      NEW.completed_at = now();
    END IF;
    IF NEW.status = 'Converted' AND NEW.estimate_sent_at IS NULL THEN
      NEW.estimate_sent_at = now();
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status = 'Completed' AND OLD.status IS DISTINCT FROM 'Completed' AND NEW.completed_at IS NULL THEN
    NEW.completed_at = now();
  END IF;
  IF NEW.status = 'Converted' AND OLD.status IS DISTINCT FROM 'Converted' AND NEW.estimate_sent_at IS NULL THEN
    NEW.estimate_sent_at = now();
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON COLUMN public.walkthroughs.estimate_sent_at IS 'Timestamp when the walkthrough reached Converted status (estimate created from walkthrough); legacy column name.';

DROP TRIGGER IF EXISTS trigger_set_walkthrough_timestamps ON public.walkthroughs;

CREATE TRIGGER trigger_set_walkthrough_timestamps
  BEFORE INSERT OR UPDATE ON public.walkthroughs
  FOR EACH ROW
  EXECUTE FUNCTION public.set_walkthrough_completed_at ();

-- ─── 4. Backfill existing rows to canonical statuses ────────────────────────

UPDATE public.walkthroughs
SET status = 'Converted'
WHERE status = 'estimate_sent';

UPDATE public.walkthroughs
SET status = 'Started'
WHERE status = 'Pending';

ALTER TABLE public.walkthroughs
  DROP CONSTRAINT IF EXISTS walkthroughs_status_check;

ALTER TABLE public.walkthroughs
  ADD CONSTRAINT walkthroughs_status_check CHECK (status IN (
    'Draft',
    'Scheduled',
    'Started',
    'Completed',
    'Converted',
    'Cancelled'));

COMMENT ON CONSTRAINT walkthroughs_status_check ON public.walkthroughs IS 'Lifecycle: Draft → Scheduled → Started → Completed → Converted; Cancelled from active states. Legacy writes estimate_sent/Pending are normalized by trigger to Converted/Started.';

-- ─── 5. Booking + walkthrough + estimate chain ──────────────────────────────

CREATE OR REPLACE FUNCTION public.enforce_booking_single_conversion_target ()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path = public
  AS $$
DECLARE
  v_wt_id uuid;
BEGIN
  IF NEW.booking_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'estimates' THEN
    SELECT
      w.id INTO v_wt_id
    FROM
      public.walkthroughs w
    WHERE
      w.booking_id = NEW.booking_id
    LIMIT 1;
    IF v_wt_id IS NOT NULL THEN
      IF NEW.walkthrough_id IS NULL OR NEW.walkthrough_id <> v_wt_id THEN
        RAISE EXCEPTION 'Booking % is already linked to walkthrough %; set estimates.walkthrough_id to that walkthrough (or clear booking_id).',
          NEW.booking_id,
          v_wt_id;
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'walkthroughs' THEN
    IF EXISTS (
      SELECT
        1
      FROM
        public.estimates e
      WHERE
        e.booking_id = NEW.booking_id
        AND (e.walkthrough_id IS DISTINCT FROM NEW.id
          OR e.walkthrough_id IS NULL)) THEN
      RAISE EXCEPTION 'Booking % is already linked to an estimate that is not tied to this walkthrough',
        NEW.booking_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ─── 6. finalize_booking_conversion (estimate branch + walkthrough chain) ──

CREATE OR REPLACE FUNCTION public.finalize_booking_conversion (
  p_booking_id uuid,
  p_estimate_id uuid DEFAULT NULL,
  p_walkthrough_id uuid DEFAULT NULL
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = public
  AS $$
DECLARE
  v_owner uuid;
  v_status text;
  v_rows int;
  v_wt_for_booking uuid;
  v_est_wt uuid;
BEGIN
  IF auth.uid () IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF (p_estimate_id IS NULL) = (p_walkthrough_id IS NULL) THEN
    RAISE EXCEPTION 'Provide exactly one of p_estimate_id or p_walkthrough_id';
  END IF;
  SELECT
    business_owner_id,
    status INTO v_owner,
    v_status
  FROM
    bookings
  WHERE
    id = p_booking_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found';
  END IF;
  IF v_owner <> auth.uid () THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  IF v_status IS DISTINCT FROM 'new' THEN
    RAISE EXCEPTION 'Booking must be in status new to convert (current: %)', v_status;
  END IF;

  SELECT
    w.id INTO v_wt_for_booking
  FROM
    walkthroughs w
  WHERE
    w.booking_id = p_booking_id
    AND w.user_id = auth.uid ()
  LIMIT 1;

  IF p_estimate_id IS NOT NULL THEN
    SELECT
      e.walkthrough_id INTO v_est_wt
    FROM
      estimates e
    WHERE
      e.id = p_estimate_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Estimate not found';
    END IF;
    IF v_wt_for_booking IS NOT NULL THEN
      IF v_est_wt IS NOT NULL AND v_est_wt IS DISTINCT FROM v_wt_for_booking THEN
        RAISE EXCEPTION 'Estimate is linked to a different walkthrough than the one for this booking';
      END IF;
    END IF;
    UPDATE
      estimates
    SET
      booking_id = p_booking_id,
      walkthrough_id = COALESCE(walkthrough_id, v_wt_for_booking)
    WHERE
      id = p_estimate_id
      AND user_id = auth.uid ()
      AND (booking_id IS NULL
        OR booking_id = p_booking_id);
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
      RAISE EXCEPTION 'Estimate not found, not owned, or already linked to another booking';
    END IF;
  ELSE
    UPDATE
      walkthroughs
    SET
      booking_id = p_booking_id
    WHERE
      id = p_walkthrough_id
      AND user_id = auth.uid ()
      AND (booking_id IS NULL
        OR booking_id = p_booking_id);
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
      RAISE EXCEPTION 'Walkthrough not found, not owned, or already linked to another booking';
    END IF;
  END IF;
  UPDATE
    bookings
  SET
    status = 'converted'
  WHERE
    id = p_booking_id;
  RETURN public.get_booking_with_conversion (p_booking_id);
END;
$$;

COMMENT ON FUNCTION public.finalize_booking_conversion (uuid, uuid, uuid) IS 'Link an estimate or walkthrough to a booking; set booking status to converted. If the booking already has a walkthrough, linking an estimate sets estimates.walkthrough_id to that walkthrough.';

-- ─── 7. RPC: Completed walkthrough → estimate (atomic) ─────────────────────

CREATE OR REPLACE FUNCTION public.finalize_walkthrough_to_estimate_conversion (
  p_walkthrough_id uuid,
  p_estimate_id uuid,
  p_allowed_walkthrough_statuses text[] DEFAULT ARRAY['Completed']::text[]
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = public
  AS $$
DECLARE
  v_uid uuid := auth.uid ();
  v_wt record;
  v_est record;
  v_rows int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT
    *
  INTO v_wt
  FROM
    walkthroughs
  WHERE
    id = p_walkthrough_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Walkthrough not found';
  END IF;
  IF v_wt.user_id <> v_uid THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  IF NOT (v_wt.status = ANY (p_allowed_walkthrough_statuses)) THEN
    RAISE EXCEPTION 'Walkthrough status % does not allow conversion (allowed: %)', v_wt.status, p_allowed_walkthrough_statuses;
  END IF;

  SELECT
    *
  INTO v_est
  FROM
    estimates
  WHERE
    id = p_estimate_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Estimate not found';
  END IF;
  IF v_est.user_id <> v_uid THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  IF v_est.walkthrough_id IS NOT NULL AND v_est.walkthrough_id IS DISTINCT FROM p_walkthrough_id THEN
    RAISE EXCEPTION 'Estimate is already linked to another walkthrough';
  END IF;
  IF v_est.booking_id IS NOT NULL
    AND v_wt.booking_id IS NOT NULL
    AND v_est.booking_id IS DISTINCT FROM v_wt.booking_id THEN
    RAISE EXCEPTION 'Estimate and walkthrough reference different bookings';
  END IF;

  UPDATE
    estimates
  SET
    walkthrough_id = p_walkthrough_id,
    booking_id = COALESCE(booking_id, v_wt.booking_id)
  WHERE
    id = p_estimate_id
    AND user_id = v_uid;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'Failed to link estimate to walkthrough';
  END IF;

  UPDATE
    walkthroughs
  SET
    status = 'Converted'
  WHERE
    id = p_walkthrough_id
    AND user_id = v_uid;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'Failed to update walkthrough status';
  END IF;

  RETURN jsonb_build_object(
    'walkthrough_id', p_walkthrough_id,
    'estimate_id', p_estimate_id,
    'walkthrough', (
      SELECT
        to_jsonb (w.*)
      FROM walkthroughs w
      WHERE
        w.id = p_walkthrough_id),
    'estimate', (
      SELECT
        to_jsonb (e.*)
      FROM estimates e
      WHERE
        e.id = p_estimate_id));
END;
$$;

COMMENT ON FUNCTION public.finalize_walkthrough_to_estimate_conversion (uuid, uuid, text[]) IS 'Links estimate to walkthrough, copies walkthrough.booking_id onto estimate when present, sets walkthrough status to Converted. Default: requires walkthrough status Completed. Optional third arg overrides allowed walkthrough statuses.';

GRANT EXECUTE ON FUNCTION public.finalize_walkthrough_to_estimate_conversion (uuid, uuid, text[]) TO authenticated;
