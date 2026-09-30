import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildGeocodeUrl,
  composeAddressQuery,
  extractCountryFromGeocodeResult,
  geocodeCountryMatchesUser,
  parseGeocodeResult,
} from "./geocodeAddress.ts";
import { resolveCountryCode } from "./userCountry.ts";

test("Google Maps geocode URL is restricted to the user country", () => {
  const url = buildGeocodeUrl({
    query: "123 Main St, Austin, TX",
    countryCode: "us",
    apiKey: "test-key",
  });
  const parsed = new URL(url);
  assert.equal(parsed.origin + parsed.pathname, "https://maps.googleapis.com/maps/api/geocode/json");
  assert.equal(parsed.searchParams.get("components"), "country:US");
  assert.equal(parsed.searchParams.get("region"), "us");
  assert.equal(parsed.searchParams.get("address"), "123 Main St, Austin, TX");
  assert.match(url, /components=country%3AUS/);
});

test("Google Maps geocode URL uses a country sent by the frontend", () => {
  const url = buildGeocodeUrl({
    query: "100 Queen St W, Toronto",
    countryCode: resolveCountryCode("ca", "us"),
    apiKey: "test-key",
  });
  assert.equal(new URL(url).searchParams.get("components"), "country:CA");
});

test("a geocode result in a different country is rejected", () => {
  const result = parseGeocodeResult({
    formatted_address: "Toronto, ON, Canada",
    geometry: { location: { lat: 43.65, lng: -79.38 } },
    address_components: [
      { long_name: "Canada", short_name: "CA", types: ["country", "political"] },
    ],
  });
  assert.equal(result?.country, "CA");
  assert.equal(geocodeCountryMatchesUser(result?.country, "US"), false);
  assert.equal(geocodeCountryMatchesUser(result?.country, "CA"), true);
});

test("composeAddressQuery prefers a full address string", () => {
  assert.equal(
    composeAddressQuery({
      address: "  10 King St  ",
      city: "Toronto",
    }),
    "10 King St",
  );
  assert.equal(
    composeAddressQuery({
      street: "10 King St",
      city: "Toronto",
      state: "ON",
      zip_code: "M5H 1H1",
    }),
    "10 King St, Toronto, ON, M5H 1H1",
  );
});

test("extractCountryFromGeocodeResult reads the country component", () => {
  const extracted = extractCountryFromGeocodeResult({
    address_components: [
      { long_name: "Austin", short_name: "Austin", types: ["locality"] },
      { long_name: "United States", short_name: "US", types: ["country"] },
    ],
  });
  assert.equal(extracted.country, "US");
  assert.equal(extracted.country_name, "United States");
});
