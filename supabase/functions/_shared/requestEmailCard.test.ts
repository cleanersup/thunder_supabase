import assert from "node:assert/strict";
import test from "node:test";
import {
  formatRequestServiceType,
  formatTimePreferred,
  renderRequestEmail,
} from "./requestEmailCard.ts";

const contact = {
  name: "Pedro Cisneros",
  email: "javiers058@gmail.com",
  phone: "(213)464-4428",
  address: "818 W Huntington Dr , Arcadia , CA , 91007",
};

const base = {
  companyName: "Clean Up Company",
  greetingName: "Javier",
  clientFirstName: "Pedro",
  dateLabel: "October 20, 2026",
  serviceType: "Residential",
  preferredDate: "October 28, 2026",
  timePreferred: "Morning",
  contact,
};

test("client request received hides the reference title and the detail block", () => {
  const html = renderRequestEmail({
    ...base,
    kind: "received",
    greetingName: "Pedro",
  });

  assert.match(html, />REQUEST RECEIVED</);
  assert.doesNotMatch(html, /CONFIRMATION REQUEST/);
  assert.match(html, /Hello Pedro,/);
  assert.match(html, /Thank you for contacting Clean Up Company !/);
  assert.match(html, /We've received your request/);
  assert.match(html, /We appreciate your interest and look forward to helping you!/);
  assert.doesNotMatch(html, /Name :/);
  assert.doesNotMatch(html, />Download PDF</);
  assert.match(html, /Service provided by/);
  assert.match(html, /www\.thunderpro\.co/);
});

test("owner new request lists the client and keeps values regular weight", () => {
  const html = renderRequestEmail({ ...base, kind: "new" });

  assert.match(html, />NEW REQUEST</);
  assert.doesNotMatch(html, /CONFIRMATION REQUEST/);
  assert.match(html, /Hello Javier,/);
  assert.match(html, /Pedro has successfully submitted a new request/);
  assert.match(html, /<span style="font-weight:700;">Date :<\/span> October 20, 2026/);
  assert.match(html, /<span style="font-weight:700;">Service Type :<\/span> Residential/);
  assert.match(html, /<span style="font-weight:700;">Preferred Date :<\/span> October 28, 2026/);
  assert.match(html, /<span style="font-weight:700;">Time Preferred :<\/span> Morning/);
  assert.match(html, /<span style="font-weight:700;">Name :<\/span> Pedro Cisneros/);
  assert.doesNotMatch(html, />Download PDF</);
  assert.doesNotMatch(html, />Pay Invoice</);
});

test("owner converted request names an estimate and is owner only copy", () => {
  const html = renderRequestEmail({
    ...base,
    kind: "converted",
    conversionTarget: "estimate",
  });

  assert.match(html, />REQUEST CONVERTED</);
  assert.match(html, /Pedro's request has been successfully converted into an Estimate/);
  assert.match(html, /view the job details/);
  assert.match(html, /<span style="font-weight:700;">Name :<\/span> Pedro Cisneros/);
  assert.doesNotMatch(html, /a Estimate/);
});

test("request field labels", () => {
  assert.equal(formatRequestServiceType("residential"), "Residential");
  assert.equal(formatTimePreferred("morning"), "Morning");
  assert.equal(formatTimePreferred("am"), "Morning");
});
