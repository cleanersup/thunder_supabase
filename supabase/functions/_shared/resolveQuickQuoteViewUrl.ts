const STAGING_QUOTE_HOST = "https://staging.thunderpro.co";
const PRODUCTION_QUOTE_HOST = "https://dashboard.thunderpro.co";

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
 * Staging only when ENVIRONMENT or an API URL says so. Default is
 * dashboard.thunderpro.co — that is the production thunder_dashboard, the
 * only production host that has /public/quick-quote/:token.
 * thunderpro.co is the marketing site (404). portal.thunderpro.co is the
 * owner app (also 404).
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

  return PRODUCTION_QUOTE_HOST;
}

/**
 * Client-facing View Quote URL used by the email button and the SMS link.
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

/**
 * Same host as the quote link. Estimates use `/public/estimate/:token`,
 * which is the page the SMS "View it here" link opens.
 */
export function resolveEstimateViewUrl(estimate: {
  id?: string | null;
  public_share_token?: string | null;
}): string | null {
  const slug = estimate.public_share_token || estimate.id;
  if (!slug) return null;
  return `${resolveQuickQuoteHost()}/public/estimate/${slug}`;
}

const STAGING_FUNCTIONS_HOST = "https://app.staging.thunderpro.co";
const PRODUCTION_FUNCTIONS_HOST = "https://portal.thunderpro.co";

function isInternalFunctionsHost(url: string): boolean {
  return url.includes("kong:8000") || url.includes("127.0.0.1") || url.includes("localhost");
}

/** Host that serves /functions/v1 for links opened outside the app. */
export function resolvePublicFunctionsHost(
  environment = env("ENVIRONMENT"),
  configured = env("PUBLIC_SUPABASE_URL_API"),
  supabaseUrl = env("SUPABASE_URL"),
): string {
  const blob = `${environment} ${configured} ${supabaseUrl}`.toLowerCase();
  const pick = (url: string) => (
    url.includes("staging.thunderpro.co") ? STAGING_FUNCTIONS_HOST : url.replace(/\/$/, "")
  );
  if (configured && !isInternalFunctionsHost(configured)) return pick(configured);
  if (supabaseUrl && !isInternalFunctionsHost(supabaseUrl)) return pick(supabaseUrl);
  if (blob.includes("staging")) return STAGING_FUNCTIONS_HOST;
  return PRODUCTION_FUNCTIONS_HOST;
}

/**
 * PDF the customer opens from SMS and email. The function returns the file
 * inline, so the phone shows the PDF instead of the web sheet.
 */
export function resolveDocumentPdfUrl(token: string | null | undefined): string | null {
  const slug = token?.trim();
  if (!slug) return null;
  return `${resolvePublicFunctionsHost()}/functions/v1/download-estimate-pdf?token=${encodeURIComponent(slug)}`;
}
