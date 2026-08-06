import { isStagingEnvironment } from "./resolvePublicSupabaseUrl.ts";

const STAGING_APP_URL = "https://app.staging.thunderpro.co";
const PRODUCTION_APP_URL = "https://portal.thunderpro.co";

/**
 * Public URL of the client-facing web app — used to build links clients click
 * from emails/SMS (invoice payment, estimate view, appointment confirmation, etc.)
 * and Stripe Checkout success/cancel redirects.
 *
 * Prefers the PUBLIC_APP_URL / APP_URL secrets when set. Otherwise infers the
 * environment instead of hardcoding staging: a prior bug (Aug 2026) had every
 * caller fall back to `https://app.staging.thunderpro.co`, so a production
 * deploy missing the secret silently sent clients to staging (e.g. the invoice
 * payment link, and the Stripe success/cancel redirect).
 */
export function resolvePublicAppUrl(): string {
  const configured = Deno.env.get("PUBLIC_APP_URL") || Deno.env.get("APP_URL");
  if (configured) return configured.replace(/\/$/, "");

  return isStagingEnvironment() ? STAGING_APP_URL : PRODUCTION_APP_URL;
}
