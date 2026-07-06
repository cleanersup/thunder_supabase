-- ─────────────────────────────────────────────────────────────────────────────
-- Owner (auth user) push notifications.
--
-- 1. user_device_tokens: FCM tokens for owner devices (swift-slate app).
-- 2. A single trigger on notifications INSERT dispatches a push to the owner,
--    so EVERY in-app notification (current and future) also becomes a push
--    without touching any email function.
-- 3. Job + walkthrough lifecycle events insert owner notifications (which then
--    push automatically through the trigger above).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pg_net;

-- ── 1. Owner device tokens ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_device_tokens (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token        text        NOT NULL,
  platform     text        NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
  is_active    boolean     NOT NULL DEFAULT true,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, token)
);

CREATE INDEX IF NOT EXISTS idx_user_device_tokens_user_active
  ON public.user_device_tokens (user_id, is_active);

COMMENT ON TABLE public.user_device_tokens IS
  'FCM push tokens for owner / business-user devices (swift-slate app).';

ALTER TABLE public.user_device_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage their own device tokens" ON public.user_device_tokens;
CREATE POLICY "Users manage their own device tokens"
  ON public.user_device_tokens
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ── 2. notifications → push dispatch ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.dispatch_notification_push ()
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
    || '/functions/v1/notify-user-push';

  SELECT net.http_post(
    url := function_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || coalesce(nullif(current_setting('app.settings.service_role_key', TRUE), ''), '')
    ),
    body := jsonb_build_object(
      'userId', NEW.user_id::text,
      'title', NEW.title,
      'body', NEW.message,
      'data', jsonb_build_object(
        'notification_id', NEW.id::text,
        'type', coalesce(NEW.type, ''),
        'related_id', coalesce(NEW.related_id::text, ''),
        'related_type', coalesce(NEW.related_type, '')
      )
    )
  ) INTO request_id;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.dispatch_notification_push () IS
  'Mirrors every in-app notification to a push via notify-user-push (best-effort).';

DROP TRIGGER IF EXISTS on_notification_created_push ON public.notifications;
CREATE TRIGGER on_notification_created_push
  AFTER INSERT ON public.notifications
  FOR EACH ROW
  EXECUTE FUNCTION public.dispatch_notification_push ();

-- ── 3a. Job lifecycle → owner notification ────────────────────────────────────
-- Notifies the owner for externally/automatically driven milestones:
-- missed (cron-set), completed, cancelled. Draft transitions are ignored.
CREATE OR REPLACE FUNCTION public.notify_owner_job_status ()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_label text;
  v_title text;
  v_msg   text;
  v_type  text;
BEGIN
  v_label := coalesce(NEW.job_number, 'A job');

  IF NEW.status = 'completed' THEN
    v_type := 'job_completed';
    v_title := 'Job completed';
    v_msg := v_label || coalesce(' for ' || NEW.client_name, '') || ' was marked completed.';
  ELSIF NEW.status = 'cancelled' THEN
    v_type := 'job_cancelled';
    v_title := 'Job cancelled';
    v_msg := v_label || coalesce(' for ' || NEW.client_name, '') || ' was cancelled.';
  ELSIF NEW.status = 'missed' THEN
    v_type := 'job_missed';
    v_title := 'Job missed';
    v_msg := v_label || coalesce(' for ' || NEW.client_name, '') || ' was not started and is now marked missed.';
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications (user_id, type, title, message, related_id, related_type)
  VALUES (NEW.user_id, v_type, v_title, v_msg, NEW.id, 'job');

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.notify_owner_job_status () IS
  'Creates an owner notification (which then pushes) on job completed/cancelled/missed.';

DROP TRIGGER IF EXISTS on_job_status_notify_owner ON public.jobs;
CREATE TRIGGER on_job_status_notify_owner
  AFTER UPDATE OF status ON public.jobs
  FOR EACH ROW
  WHEN (
    OLD.status IS DISTINCT FROM NEW.status
    AND NEW.status IN ('completed', 'cancelled', 'missed')
  )
  EXECUTE FUNCTION public.notify_owner_job_status ();

-- ── 3b. Walkthrough lifecycle → owner notification ────────────────────────────
-- Notifies the owner when a walkthrough is completed (often via the public form)
-- or cancelled.
CREATE OR REPLACE FUNCTION public.notify_owner_walkthrough_status ()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_title text;
  v_msg   text;
  v_type  text;
  v_service text;
BEGIN
  v_service := coalesce(NEW.service_type, 'walkthrough');

  IF NEW.status = 'Completed' THEN
    v_type := 'walkthrough_completed';
    v_title := 'Walkthrough completed';
    v_msg := 'A ' || v_service || ' walkthrough was completed.';
  ELSIF NEW.status = 'Cancelled' THEN
    v_type := 'walkthrough_cancelled';
    v_title := 'Walkthrough cancelled';
    v_msg := 'A ' || v_service || ' walkthrough was cancelled.';
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications (user_id, type, title, message, related_id, related_type)
  VALUES (NEW.user_id, v_type, v_title, v_msg, NEW.id, 'walkthrough');

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.notify_owner_walkthrough_status () IS
  'Creates an owner notification (which then pushes) on walkthrough completed/cancelled.';

DROP TRIGGER IF EXISTS on_walkthrough_status_notify_owner ON public.walkthroughs;
CREATE TRIGGER on_walkthrough_status_notify_owner
  AFTER UPDATE OF status ON public.walkthroughs
  FOR EACH ROW
  WHEN (
    OLD.status IS DISTINCT FROM NEW.status
    AND NEW.status IN ('Completed', 'Cancelled')
  )
  EXECUTE FUNCTION public.notify_owner_walkthrough_status ();
