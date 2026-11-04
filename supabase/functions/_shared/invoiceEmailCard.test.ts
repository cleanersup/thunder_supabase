import assert from "node:assert/strict";
import test from "node:test";
import { renderInvoiceEmail, renderInvoiceReminderEmail } from "./invoiceEmailCard.ts";

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

test("client invoice reminder uses the invoice card and Pay Now", () => {
  const { subject, html } = renderInvoiceReminderEmail({
    ...base,
    audience: "client",
    clientName: "Pedro Cisneros",
    amountDue: "$150.00",
    contact: ownerContact,
    trackingPixelUrl: "https://portal.thunderpro.co/functions/v1/mark-viewed?type=invoice&id=1",
  });

  assert.equal(subject, "Clean Up Company sent you a invoice reminder");
  assert.match(html, />INVOICE</);
  assert.match(html, /Hello Pedro,/);
  assert.match(html, /Payment Due Today\. This invoice is due today/);
  assert.match(html, /friendly reminder that your invoice from Clean Up Company is due today/);
  assert.match(html, /If you have any questions, please contact us at Clean Up Company/);
  assert.match(html, /<span style="font-weight:700;">Invoice Number :<\/span> IN-2026-034/);
  assert.match(html, /<span style="font-weight:700;">Total Amount Due :<\/span> \$150\.00/);
  assert.match(html, /<span style="font-weight:700;">Name :<\/span> Javier Silva/);
  assert.match(html, />Pay Now</);
  assert.match(html, /background-color:#239445/);
  assert.match(html, /invoice\/payment\/abc/);
  assert.match(html, /mark-viewed/);
  assert.doesNotMatch(html, /Download PDF/);
  assert.doesNotMatch(html, /INVOICE CONFIRMATION/);
});

test("owner invoice reminder names the client and has no pay button", () => {
  const { subject, html } = renderInvoiceReminderEmail({
    ...base,
    audience: "owner",
    greetingName: "Javier",
    clientName: "Pedro Cisneros",
    amountDue: "$150.00",
    contact: clientContact,
    payUrl: null,
  });

  assert.equal(subject, "A reminder invoice was sent to Pedro Cisneros");
  assert.match(html, /Hello Javier,/);
  assert.match(html, /A payment reminder was sent to Pedro Cisneros for the following invoice/);
  assert.match(html, /<span style="font-weight:700;">Name :<\/span> Pedro Cisneros/);
  assert.match(html, /Total Amount Due :<\/span> \$150\.00/);
  assert.doesNotMatch(html, /Pay Now/);
  assert.doesNotMatch(html, /Download PDF/);
});
