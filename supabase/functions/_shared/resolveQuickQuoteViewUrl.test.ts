import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveDocumentPdfUrl, resolveEstimateViewUrl, resolveInvoicePdfUrl, resolveQuickQuoteHost, resolveQuickQuoteViewUrl } from "./resolveQuickQuoteViewUrl.ts";

test("View Quote host is staging.thunderpro.co when ENVIRONMENT is staging", () => {
  assert.equal(resolveQuickQuoteHost("staging", "http://kong:8000"), "https://staging.thunderpro.co");
});

test("View Quote host is staging.thunderpro.co when the API URL mentions staging", () => {
  assert.equal(
    resolveQuickQuoteHost("", "https://app.staging.thunderpro.co"),
    "https://staging.thunderpro.co",
  );
});

test("View Quote host is dashboard.thunderpro.co when ENVIRONMENT is production", () => {
  assert.equal(resolveQuickQuoteHost("production", "http://kong:8000"), "https://dashboard.thunderpro.co");
});

test("View Quote host is dashboard.thunderpro.co for the production portal API", () => {
  assert.equal(
    resolveQuickQuoteHost("", "https://portal.thunderpro.co"),
    "https://dashboard.thunderpro.co",
  );
});

test("View Quote host defaults to production when Docker only has kong", () => {
  assert.equal(resolveQuickQuoteHost("", "http://kong:8000"), "https://dashboard.thunderpro.co");
});

test("View Estimate URL uses /public/estimate/ on the same host as SMS", () => {
  const url = resolveEstimateViewUrl({
    id: "11111111-1111-1111-1111-111111111111",
    public_share_token: "estimateToken",
  });
  assert.equal(url?.endsWith("/public/estimate/estimateToken"), true);
  assert.match(url ?? "", /^https:\/\/(staging|dashboard)\.thunderpro\.co\/public\/estimate\/estimateToken$/);
});

test("SMS and email open the PDF inline from the public functions host", () => {
  assert.equal(
    resolveDocumentPdfUrl("abc123token"),
    "https://portal.thunderpro.co/functions/v1/download-estimate-pdf?token=abc123token",
  );
  assert.equal(resolveDocumentPdfUrl("  "), null);
});

test("invoice SMS and email open the invoice PDF", () => {
  assert.equal(
    resolveInvoicePdfUrl("paytoken"),
    "https://portal.thunderpro.co/functions/v1/download-invoice-pdf?token=paytoken",
  );
});

test("View Quote URL uses /public/quick-quote/ on the hardcoded host", () => {
  const url = resolveQuickQuoteViewUrl({
    id: "11111111-1111-1111-1111-111111111111",
    public_share_token: "abc123token",
  });
  assert.equal(url?.endsWith("/public/quick-quote/abc123token"), true);
  assert.match(url ?? "", /^https:\/\/(staging|dashboard)\.thunderpro\.co\/public\/quick-quote\/abc123token$/);
});
