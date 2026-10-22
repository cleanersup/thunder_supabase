import assert from "node:assert/strict";
import test from "node:test";
import {
  documentCode,
  formatPhoneDisplay,
  formatStreetAddress,
  personFirstName,
  renderDocumentEmail,
} from "./documentEmailCard.ts";

const contact = {
  name: "Pedro Cisneros",
  email: "javiers058@gmail.com",
  phone: "(213)464-4428",
  address: "818 W Huntington Dr , Arcadia , CA , 91007",
};

test("client send estimate uses the card and hides the reference title", () => {
  const html = renderDocumentEmail({
    kind: "estimate",
    audience: "client",
    moment: "sent",
    companyName: "Clean Up Company",
    greetingName: "Pedro",
    clientFirstName: "Pedro",
    documentNumber: "A1B2C3D4",
    dateLabel: "October 20, 2026",
    serviceType: "Residential",
    contact,
    pdfUrl: "https://portal.thunderpro.co/functions/v1/download-estimate-pdf?token=abc",
    acceptUrl: "https://portal.thunderpro.co/functions/v1/accept-estimate?id=1",
    trackingPixelUrl: "https://portal.thunderpro.co/functions/v1/mark-viewed?type=estimate&id=1",
  });

  assert.match(html, /background-color:#e6e6e6/);
  assert.match(html, />ESTIMATE</);
  assert.doesNotMatch(html, /CONFIRMATION FOR CLIENT/);
  assert.match(html, /Hello Pedro,/);
  assert.match(html, /Clean Up Company has sent you an estimate/);
  assert.match(html, /<span style="font-weight:700;">Estimate Number :<\/span> A1B2C3D4/);
  assert.match(html, /<span style="font-weight:700;">Name :<\/span> Pedro Cisneros/);
  assert.match(html, /<span style="font-weight:700;">Address :<\/span> 818 W Huntington Dr/);
  assert.match(html, /Service Type :<\/span> Residential/);
  assert.match(html, /Pedro Cisneros/);
  assert.match(html, />Accept Estimate</);
  assert.match(html, />View Estimate</);
  assert.match(html, /Service provided by/);
  assert.match(html, /www\.thunderpro\.co/);
  assert.match(html, /mark-viewed/);
});

test("client send quote uses estimate button names", () => {
  const html = renderDocumentEmail({
    kind: "quote",
    audience: "client",
    moment: "sent",
    companyName: "Clean Up Company",
    greetingName: "Pedro",
    clientFirstName: "Pedro",
    documentNumber: "Q1",
    dateLabel: "October 20, 2026",
    serviceType: "Single Payment",
    contact,
    pdfUrl: "https://portal.thunderpro.co/functions/v1/download-estimate-pdf?token=q",
    acceptUrl: "https://portal.thunderpro.co/functions/v1/accept-quick-quote?id=1",
  });

  assert.match(html, /sent you an estimate/);
  assert.match(html, /Estimate Number :<\/span> Q1/);
  assert.match(html, />Accept Estimate</);
  assert.match(html, />View Estimate</);
  assert.match(html, /click the Accept Estimate button/);
  assert.doesNotMatch(html, /Accept Quote/);
  assert.doesNotMatch(html, /View Quote/);
  assert.doesNotMatch(html, /Quote Number/);
});

test("owner accepted quote names the client and offers the PDF", () => {
  const html = renderDocumentEmail({
    kind: "quote",
    audience: "owner",
    moment: "accepted",
    companyName: "Clean Up Company",
    greetingName: "Javier",
    clientFirstName: "Pedro",
    documentNumber: "Q1",
    dateLabel: "October 20, 2026",
    serviceType: "Single Payment",
    contact: { ...contact, name: "Javier Silva" },
    pdfUrl: "https://portal.thunderpro.co/functions/v1/download-estimate-pdf?token=q",
    acceptUrl: null,
  });

  assert.match(html, />ESTIMATE</);
  assert.doesNotMatch(html, />QUOTE</);
  assert.doesNotMatch(html, /ACCEPTED CONFIRMATION/);
  assert.match(html, /Hello Javier,/);
  assert.match(html, /Great news ! Pedro has accepted your estimate/);
  assert.match(html, /Estimate Number :<\/span> Q1/);
  assert.doesNotMatch(html, /Quote Number/);
  assert.doesNotMatch(html, /\bquote\b/i);
  assert.match(html, /Javier Silva/);
  assert.match(html, />Download PDF</);
  assert.doesNotMatch(html, /Accept Quote/);
});

test("client estimate update uses the update banner and both buttons", () => {
  const html = renderDocumentEmail({
    kind: "estimate",
    audience: "client",
    moment: "sent",
    companyName: "Clean Up Company",
    greetingName: "Pedro",
    clientFirstName: "Pedro",
    documentNumber: "A1B2C3D4",
    dateLabel: "October 20, 2026",
    serviceType: "Residential",
    contact,
    pdfUrl: "https://portal.thunderpro.co/functions/v1/download-estimate-pdf?token=abc",
    acceptUrl: "https://portal.thunderpro.co/functions/v1/accept-estimate?id=1",
    isUpdate: true,
  });

  assert.match(html, />ESTIMATE UPDATE</);
  assert.doesNotMatch(html, /CONFIRMATION FOR CLIENT/);
  assert.match(html, /Hello Pedro,/);
  assert.match(html, /Clean Up Company has updated your estimate\./);
  assert.match(html, /click the View Estimate button below to review the updated details online/);
  assert.match(html, /Thank you for choosing Clean Up Company!/);
  assert.match(html, />Accept Estimate</);
  assert.match(html, />View Estimate</);
  assert.doesNotMatch(html, /sent you an estimate/);
});

test("owner estimate update names the client and offers the PDF", () => {
  const html = renderDocumentEmail({
    kind: "estimate",
    audience: "owner",
    moment: "sent",
    companyName: "Clean Up Company",
    greetingName: "Javier",
    clientFirstName: "Pedro",
    documentNumber: "A1B2C3D4",
    dateLabel: "October 20, 2026",
    serviceType: "Residential",
    contact: { ...contact, name: "Javier Silva" },
    pdfUrl: "https://portal.thunderpro.co/functions/v1/download-estimate-pdf?token=abc",
    acceptUrl: null,
    isUpdate: true,
  });

  assert.match(html, />ESTIMATE UPDATE</);
  assert.doesNotMatch(html, /CONFIRMATION TO OWNER/);
  assert.match(html, /Hello Javier,/);
  assert.match(html, /Your estimate for Pedro has been successfully updated/);
  assert.match(html, /Javier Silva/);
  assert.match(html, />Download PDF</);
  assert.doesNotMatch(html, />Accept Estimate</);
  assert.doesNotMatch(html, />View Estimate</);
});

test("contact helpers", () => {
  assert.equal(personFirstName("Pedro Cisneros"), "Pedro");
  assert.equal(formatPhoneDisplay("2134644428"), "(213)464-4428");
  assert.equal(
    formatStreetAddress(["818 W Huntington Dr", "", "Arcadia", "CA", "91007"]),
    "818 W Huntington Dr , Arcadia , CA , 91007",
  );
  assert.equal(documentCode("a1b2c3d4-1111-2222-3333-444444444444"), "A1B2C3D4");
});
