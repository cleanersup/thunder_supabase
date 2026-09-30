export type UserCountry = {
  /** ISO 3166-1 alpha-2 uppercase, e.g. "US". API / login shape. */
  country: string;
  /** Human-readable name, e.g. "United States". */
  country_name: string;
  /** ISO 3166-1 alpha-2 lowercase, e.g. "us". Stored on tables. */
  code: string;
};

type RpcClient = {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

const FALLBACK: UserCountry = {
  country: "US",
  country_name: "United States",
  code: "us",
};

function normalizeInfo(raw: unknown): UserCountry {
  if (!raw || typeof raw !== "object") return FALLBACK;
  const record = raw as Record<string, unknown>;
  const country = String(record.country ?? "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) return FALLBACK;
  return {
    country,
    country_name: String(record.country_name ?? "").trim() || FALLBACK.country_name,
    code: country.toLowerCase(),
  };
}

/**
 * Registration country for this account. Edge functions call this when the
 * request does not include a country; if the frontend sends one, keep it.
 */
export async function getUserCountry(
  supabase: RpcClient,
  userId: string | null | undefined,
): Promise<UserCountry> {
  if (!userId) return FALLBACK;

  const { data, error } = await supabase.rpc("get_user_country_info", {
    p_user_id: userId,
  });

  if (error) {
    console.error("getUserCountry rpc error:", error);
    return FALLBACK;
  }

  return normalizeInfo(data);
}

export function isProvidedCountry(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * Prefer a country sent by the caller. Fall back to the registration country
 * when the request omits it or sends a non-ISO value.
 */
export function resolveCountryCode(sent: unknown, fallbackCode: string): string {
  const fallback = (fallbackCode || "us").trim().toLowerCase() || "us";
  if (!isProvidedCountry(sent)) return fallback;
  const v = sent.trim();
  if (/^[a-zA-Z]{2}$/.test(v)) return v.toLowerCase();
  return fallback;
}

export async function resolveRecordCountry(
  supabase: RpcClient,
  userId: string | null | undefined,
  sent: unknown,
): Promise<string> {
  const registration = await getUserCountry(supabase, userId);
  return resolveCountryCode(sent, registration.code);
}

export function toIsoUpper(code: string | null | undefined): string {
  const v = String(code ?? "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(v) ? v : "US";
}
