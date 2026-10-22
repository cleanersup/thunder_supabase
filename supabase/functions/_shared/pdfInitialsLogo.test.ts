import assert from "node:assert/strict";
import test from "node:test";
import { companyInitials } from "./pdfInitialsLogo.ts";

test("company initials use the first and last word", () => {
  assert.equal(companyInitials("Pedros Cleaning"), "PC");
  assert.equal(companyInitials("Clean Up Company"), "CC");
  assert.equal(companyInitials("Pedros"), "PE");
  assert.equal(companyInitials("  "), "");
});
