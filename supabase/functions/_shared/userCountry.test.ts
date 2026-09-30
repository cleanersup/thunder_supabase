import { test } from "node:test";
import assert from "node:assert/strict";
import { getUserCountry, resolveCountryCode, toIsoUpper } from "./userCountry.ts";

function mockSupabase(data: unknown, error: { message: string } | null = null) {
  return {
    rpc: (_name: string, _args: Record<string, unknown>) =>
      Promise.resolve({ data, error }),
  };
}

test("login / me-country shape uses uppercase ISO plus display name", async () => {
  const country = await getUserCountry(
    mockSupabase({ country: "CA", country_name: "Canada" }),
    "user-1",
  );
  assert.deepEqual(country, {
    country: "CA",
    country_name: "Canada",
    code: "ca",
  });
});

test("getUserCountry falls back to US when userId is missing", async () => {
  const country = await getUserCountry(mockSupabase(null), null);
  assert.equal(country.country, "US");
  assert.equal(country.code, "us");
});

test("getUserCountry ignores invalid RPC payloads", async () => {
  const country = await getUserCountry(mockSupabase({ country: "USA" }), "user-1");
  assert.equal(country.country, "US");
});

test("toIsoUpper normalizes stored lowercase codes", () => {
  assert.equal(toIsoUpper("mx"), "MX");
  assert.equal(toIsoUpper("not-a-country"), "US");
});

test("resolveCountryCode keeps a frontend ISO country and falls back when omitted", () => {
  assert.equal(resolveCountryCode("MX", "ca"), "mx");
  assert.equal(resolveCountryCode("ca", "us"), "ca");
  assert.equal(resolveCountryCode(null, "ca"), "ca");
  assert.equal(resolveCountryCode("", "ca"), "ca");
  assert.equal(resolveCountryCode("United States", "ca"), "ca");
});
