export type GeocodeAddressInput = {
  address?: string | null;
  street?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  zip_code?: string | null;
  country?: string | null;
};

export type GeocodeResult = {
  formatted_address: string;
  lat: number;
  lng: number;
  country: string;
  country_name: string | null;
};

type GoogleAddressComponent = {
  long_name?: string;
  short_name?: string;
  types?: string[];
};

type GoogleGeocodeResult = {
  formatted_address?: string;
  address_components?: GoogleAddressComponent[];
  geometry?: { location?: { lat: number; lng: number } };
};

export function composeAddressQuery(input: GeocodeAddressInput): string {
  if (input.address && input.address.trim()) return input.address.trim();
  return [input.street, input.city, input.state, input.zip ?? input.zip_code]
    .map((part) => (part ?? "").trim())
    .filter(Boolean)
    .join(", ");
}

export function buildGeocodeUrl(opts: {
  query: string;
  countryCode: string;
  apiKey: string;
}): string {
  const iso = opts.countryCode.trim().toUpperCase();
  const params = new URLSearchParams({
    address: opts.query,
    components: `country:${iso}`,
    region: iso.toLowerCase(),
    key: opts.apiKey,
  });
  return `https://maps.googleapis.com/maps/api/geocode/json?${params.toString()}`;
}

export function extractCountryFromGeocodeResult(
  result: GoogleGeocodeResult | null | undefined,
): { country: string | null; country_name: string | null } {
  const components = result?.address_components ?? [];
  const country = components.find((c) => (c.types ?? []).includes("country"));
  const code = (country?.short_name ?? "").trim().toUpperCase();
  return {
    country: /^[A-Z]{2}$/.test(code) ? code : null,
    country_name: country?.long_name?.trim() || null,
  };
}

export function parseGeocodeResult(
  result: GoogleGeocodeResult | null | undefined,
): GeocodeResult | null {
  const lat = result?.geometry?.location?.lat;
  const lng = result?.geometry?.location?.lng;
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  const { country, country_name } = extractCountryFromGeocodeResult(result);
  if (!country) return null;
  return {
    formatted_address: result?.formatted_address ?? "",
    lat,
    lng,
    country,
    country_name,
  };
}

export function geocodeCountryMatchesUser(
  resultCountry: string | null | undefined,
  userCountry: string,
): boolean {
  if (!resultCountry) return false;
  return resultCountry.trim().toUpperCase() === userCountry.trim().toUpperCase();
}
