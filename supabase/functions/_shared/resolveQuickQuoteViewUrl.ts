const STAGING_QUOTE_HOST = "https://staging.thunderpro.co";
const PRODUCTION_QUOTE_HOST = "https://thunderpro.co";

function env(name: string): string {
  const deno = (globalThis as {
    Deno?: { env?: { get: (key: string) => string | undefined } };
  }).Deno;
  return deno?.env?.get(name) ?? "";
}

/**
 * Host for the public View Quote page.
 *
 * Do not use PUBLIC_APP_URL / APP_URL here: those often point at
 * app.staging.thunderpro.co or portal.thunderpro.co, which are not the
 * dashboard that serves the quote. Edge functions inside Docker also see
 * SUPABASE_URL=http://kong:8000, so "staging" may be missing from env.
 *
 * Staging unless ENVIRONMENT is production/prod, or the API URL is the
 * production portal and does not mention staging.
 */
export function resolveQuickQuoteHost(
  environment = env("ENVIRONMENT"),
  apiUrls = [env("PUBLIC_SUPABASE_URL_API"), env("SUPABASE_URL")]
    .filter(Boolean)
    .join(" "),
): string {
  const envName = environment.toLowerCase().trim();
  const blob = apiUrls.toLowerCase();

  if (envName === "staging" || envName === "dev" || envName === "development") {
    return STAGING_QUOTE_HOST;
  }
  if (blob.includes("staging")) {
    return STAGING_QUOTE_HOST;
  }
  if (envName === "production" || envName === "prod") {
    return PRODUCTION_QUOTE_HOST;
  }
  if (blob.includes("portal.thunderpro.co")) {
    return PRODUCTION_QUOTE_HOST;
  }

  return STAGING_QUOTE_HOST;
}

/**
 * Client-facing View Quote URL used only by the email button and the SMS link.
 * Staging and production both serve `/public/quick-quote/:token`.
 */
export function resolveQuickQuoteViewUrl(quote: {
  id?: string | null;
  public_share_token?: string | null;
}): string | null {
  const slug = quote.public_share_token || quote.id;
  if (!slug) return null;
  return `${resolveQuickQuoteHost()}/public/quick-quote/${slug}`;
}
