const STAGING_PUBLIC_API_URL = "https://app.staging.thunderpro.co";
const PRODUCTION_PUBLIC_API_URL = "https://portal.thunderpro.co";

function trimTrailingSlash(url: string): string {
  return url.replace(/\/$/, "");
}

function isInternalSupabaseUrl(url: string): boolean {
  return (
    url.includes("kong:8000") ||
    url.includes("127.0.0.1") ||
    url.includes("localhost")
  );
}

export function isStagingEnvironment(): boolean {
  const envValues = [
    Deno.env.get("ENVIRONMENT"),
    Deno.env.get("PUBLIC_SUPABASE_URL_API"),
    Deno.env.get("PUBLIC_APP_URL"),
    Deno.env.get("APP_URL"),
    Deno.env.get("SUPABASE_URL"),
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLowerCase();

  return envValues.includes("staging") || envValues.includes("app.staging.thunderpro.co");
}

function mapLegacyPublicSupabaseUrl(url: string): string {
  const normalized = trimTrailingSlash(url);

  if (normalized.includes("staging.thunderpro.co")) {
    return STAGING_PUBLIC_API_URL;
  }

  return normalized;
}

/**
 * Public URL where Supabase Edge Functions are reachable in emails and links.
 * Staging: https://app.staging.thunderpro.co
 * Production: https://portal.thunderpro.co
 */
export function resolvePublicSupabaseUrl(): string {
  const configured = Deno.env.get("PUBLIC_SUPABASE_URL_API");
  if (configured) {
    return mapLegacyPublicSupabaseUrl(configured);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  if (supabaseUrl && !isInternalSupabaseUrl(supabaseUrl)) {
    return mapLegacyPublicSupabaseUrl(supabaseUrl);
  }

  return isStagingEnvironment()
    ? STAGING_PUBLIC_API_URL
    : PRODUCTION_PUBLIC_API_URL;
}
