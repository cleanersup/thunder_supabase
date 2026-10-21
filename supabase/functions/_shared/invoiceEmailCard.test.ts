import assert from "node:assert/strict";
import test from "node:test";
import { renderInvoiceEmail } from "./invoiceEmailCard.ts";

const clientContact = {
  name: "Pedro Cisneros",
  email: "pedro@example.com",
  phone: "(213)464-4428",
  address: "818 W Huntington Dr , Arcadia , CA , 91007",
};

const ownerContact = {
  name: "Javier Silva",
  email: "javiers058@gmail.com",
  phone: "(213)464-4428",
  address: "818 W Huntington Dr , Arcadia , CA , 91007",
};

const base = {
  companyName: "Clean Up Company",
  greetingName: "Pedro",
  clientFirstName: "Pedro",
  invoiceNumber: "IN-2026-034",
  invoiceDate: "October 20, 2026",
  dueDate: "October 28, 2026",
  serviceType: "Single Payment",
  pdfUrl: "https://portal.thunderpro.co/functions/v1/download-invoice-pdf?token=abc",
  payUrl: "https://dashboard.thunderpro.co/invoice/payment/abc",
};

test("client send invoice uses the card and the pay button", () => {
  const html = renderInvoiceEmail({
    ...base,
    audience: "client",
    moment: "sent",
    contact: ownerContact,
    trackingPixelUrl: "https://portal.thunderpro.co/functions/v1/mark-viewed?type=invoice&id=1",
  });

  assert.match(html, />INVOICE</);
  assert.doesNotMatch(html, /INVOICE CONFIRMATION/);
  assert.match(html, /Hello Pedro,/);
  assert.match(html, /You've received an invoice from Clean Up Company/);
  assert.match(html, /click the Pay button below/);
  assert.match(html, /<span style="font-weight:700;">Invoice Number :<\/span> IN-2026-034/);
  assert.match(html, /<span style="font-weight:700;">Due Date :<\/span> October 28, 2026/);
  assert.match(html, /<span style="font-weight:700;">Name :<\/span> Javier Silva/);
  assert.match(html, />Pay Invoice</);
  assert.match(html, />Download PDF</);
  assert.match(html, /invoice\/payment\/abc/);
  assert.match(html, /download-invoice-pdf/);
  assert.match(html, /Service provided by/);
  assert.match(html, /www\.thunderpro\.co/);
  assert.match(html, /mark-viewed/);
  assert.doesNotMatch(html, /Line Items/);
});

test("owner send invoice names the client and offers the PDF", () => {
  const html = renderInvoiceEmail({
    ...base,
    audience: "owner",
    moment: "sent",
    greetingName: "Javier",
    contact: clientContact,
    payUrl: null,
  });

  assert.match(html, /Hello Javier,/);
  assert.match(html, /Invoice Sent Successfully/);
  assert.match(html, /successfully sent to Pedro/);
  assert.match(html, /<span style="font-weight:700;">Name :<\/span> Pedro Cisneros/);
  assert.match(html, />Download PDF</);
  assert.doesNotMatch(html, /Pay Invoice/);
  assert.doesNotMatch(html, /CONFIRMATION FOR OWNER/);
});

test("paid confirmations use the receipt copy", () => {
  const clientHtml = renderInvoiceEmail({
    ...base,
    audience: "client",
    moment: "paid",
    contact: ownerContact,
    payUrl: null,
  });
  const ownerHtml = renderInvoiceEmail({
    ...base,
    audience: "owner",
    moment: "paid",
    greetingName: "Javier",
    contact: clientContact,
    payUrl: null,
  });

  assert.match(clientHtml, /Your payment to Clean Up Company has been received successfully/);
  assert.match(clientHtml, />Download PDF</);
  assert.doesNotMatch(clientHtml, /Pay Invoice/);
  assert.match(ownerHtml, /Payment Received Successfully/);
  assert.match(ownerHtml, /Pedro has successfully paid the invoice/);
  assert.doesNotMatch(ownerHtml, /Pay Invoice/);
});
