import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveQuickQuoteHost, resolveQuickQuoteViewUrl } from "./resolveQuickQuoteViewUrl.ts";

test("View Quote host is staging.thunderpro.co when ENVIRONMENT is staging", () => {
  assert.equal(resolveQuickQuoteHost("staging", "http://kong:8000"), "https://staging.thunderpro.co");
});

test("View Quote host is staging.thunderpro.co when the API URL mentions staging", () => {
  assert.equal(
    resolveQuickQuoteHost("", "https://app.staging.thunderpro.co"),
    "https://staging.thunderpro.co",
  );
});

test("View Quote host is thunderpro.co when ENVIRONMENT is production", () => {
  assert.equal(resolveQuickQuoteHost("production", "http://kong:8000"), "https://thunderpro.co");
});

test("View Quote host is thunderpro.co for the production portal API", () => {
  assert.equal(
    resolveQuickQuoteHost("", "https://portal.thunderpro.co"),
    "https://thunderpro.co",
  );
});

test("View Quote host defaults to staging when Docker only has kong", () => {
  assert.equal(resolveQuickQuoteHost("", "http://kong:8000"), "https://staging.thunderpro.co");
});

test("View Quote URL uses /public/quick-quote/ on the hardcoded host", () => {
  const url = resolveQuickQuoteViewUrl({
    id: "11111111-1111-1111-1111-111111111111",
    public_share_token: "abc123token",
  });
  assert.equal(url?.endsWith("/public/quick-quote/abc123token"), true);
  assert.match(url ?? "", /^https:\/\/(staging\.)?thunderpro\.co\/public\/quick-quote\/abc123token$/);
});
