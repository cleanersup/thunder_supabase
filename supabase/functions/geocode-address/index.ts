import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";
import { getUserCountry, resolveCountryCode } from "../_shared/userCountry.ts";
import {
  buildGeocodeUrl,
  composeAddressQuery,
  geocodeCountryMatchesUser,
  parseGeocodeResult,
  type GeocodeAddressInput,
} from "../_shared/geocodeAddress.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "Unauthorized" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return json({ error: "Unauthorized" }, 401);
    }

    const apiKey =
      Deno.env.get("GOOGLE_MAPS_API_KEY") ||
      Deno.env.get("GOOGLE_GEOCODING_API_KEY") ||
      "";
    if (!apiKey) {
      return json({ error: "GOOGLE_MAPS_API_KEY is not configured" }, 500);
    }

    const body = (await req.json()) as GeocodeAddressInput;
    const query = composeAddressQuery(body);
    if (!query) {
      return json({ error: "address is required" }, 400);
    }

    const userCountry = await getUserCountry(supabase, user.id);
    const countryCode = resolveCountryCode(body.country, userCountry.country).toUpperCase();
    const url = buildGeocodeUrl({
      query,
      countryCode,
      apiKey,
    });

    const response = await fetch(url);
    if (!response.ok) {
      return json({ error: "Geocoding provider error" }, 502);
    }

    const payload = await response.json() as {
      status?: string;
      results?: unknown[];
      error_message?: string;
    };

    if (payload.status === "ZERO_RESULTS" || !payload.results?.length) {
      return json({
        error: "Address not found in the requested country",
        country: countryCode,
        country_name: countryCode === userCountry.country ? userCountry.country_name : null,
      }, 404);
    }

    const parsed = parseGeocodeResult(
      payload.results[0] as Parameters<typeof parseGeocodeResult>[0],
    );

    if (!parsed || !geocodeCountryMatchesUser(parsed.country, countryCode)) {
      return json({
        error: "Address is outside the requested country",
        country: countryCode,
        country_name: countryCode === userCountry.country ? userCountry.country_name : null,
        geocoded_country: parsed?.country ?? null,
      }, 422);
    }

    return json({
      ...parsed,
      country: countryCode,
      country_name: parsed.country_name ?? (countryCode === userCountry.country ? userCountry.country_name : null),
    });
  } catch (error) {
    console.error("geocode-address error:", error);
    return json({
      error: error instanceof Error ? error.message : "Internal server error",
    }, 500);
  }
});
