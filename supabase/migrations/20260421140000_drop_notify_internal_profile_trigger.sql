-- The pg_net trigger notify_internal_on_profile_created often failed because
-- app.settings.service_role_key was unset (Bearer null). Internal signup alerts
-- are now sent from the app via notify-internal-registration after profile insert.

DROP TRIGGER IF EXISTS on_profile_created_notify_internal ON public.profiles;

DROP FUNCTION IF EXISTS public.notify_internal_on_profile_created();
