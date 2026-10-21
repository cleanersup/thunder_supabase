/**
 * Invoice email card. Same shell as the estimate email.
 * Reference titles such as "INVOICE CONFIRMATION FOR CLIENT" are not rendered.
 */

import {
  EMAIL_GREEN,
  EMAIL_NAVY,
  type DocumentEmailContact,
  emailActionButton,
  emailDetailLine,
  escapeHtml,
  renderBrandedEmailCard,
} from "./documentEmailCard.ts";

export type InvoiceEmailAudience = "client" | "owner";
export type InvoiceEmailMoment = "sent" | "paid";

export interface InvoiceEmailInput {
  audience: InvoiceEmailAudience;
  moment: InvoiceEmailMoment;
  companyName: string;
  greetingName: string;
  clientFirstName: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  serviceType: string;
  contact: DocumentEmailContact;
  pdfUrl: string | null;
  payUrl: string | null;
  trackingPixelUrl?: string | null;
  isUpdate?: boolean;
}

function statusLine(input: InvoiceEmailInput): string {
  if (input.audience !== "owner") return "";
  if (input.moment === "paid") return "Payment Received Successfully";
  return input.isUpdate ? "Invoice Updated Successfully" : "Invoice Sent Successfully";
}

function bodyCopy(input: InvoiceEmailInput): string {
  const company = input.companyName.trim() || "your cleaning company";
  const client = input.clientFirstName.trim() || "your client";

  if (input.moment === "paid" && input.audience === "client") {
    return `Your payment to ${company} has been received successfully. Thank you for your payment! You can download your payment receipt in PDF format by clicking the Download PDF button below.`;
  }
  if (input.moment === "paid") {
    return `${client} has successfully paid the invoice. The payment has been recorded, and the customer can download the payment receipt in PDF format.`;
  }
  if (input.audience === "owner") {
    const updated = input.isUpdate ? "updated " : "";
    return `Your ${updated}invoice has been successfully sent to ${client}. The customer has been notified and can review the invoice details and pay online.`;
  }
  const updated = input.isUpdate ? "updated " : "";
  return `You've received an ${updated}invoice from ${company}. Please download the attached PDF to review the details, or click the Pay button below to pay online.`;
}

export function renderInvoiceEmail(input: InvoiceEmailInput): string {
  const hello = input.greetingName.trim() || "there";
  const status = statusLine(input);
  const statusHtml = status
    ? `<p style="margin:0 0 18px 0;font-size:14px;line-height:1.5;">${escapeHtml(status)}</p>\n`
    : "";
  const introHtml = `<p style="margin:0 0 14px 0;font-size:14px;line-height:1.5;">Hello ${escapeHtml(hello)},</p>
${statusHtml}<p style="margin:0 0 22px 0;font-size:14px;line-height:1.55;">${escapeHtml(bodyCopy(input))}</p>`;

  const lines = [
    emailDetailLine("Invoice Number", input.invoiceNumber),
    emailDetailLine("Invoice Date", input.invoiceDate),
    emailDetailLine("Due Date", input.dueDate),
    emailDetailLine("Service Type", input.serviceType),
    `<p style="margin:0 0 14px 0;font-size:8px;line-height:8px;">&nbsp;</p>`,
    emailDetailLine("Name", input.contact.name),
    emailDetailLine("Email", input.contact.email),
    emailDetailLine("Phone", input.contact.phone),
    emailDetailLine("Address", input.contact.address),
  ].join("");

  const actions: string[] = [];
  if (input.moment === "sent" && input.audience === "client" && input.payUrl) {
    actions.push(emailActionButton(input.payUrl, "Pay Invoice", EMAIL_GREEN));
  }
  if (input.pdfUrl) {
    actions.push(emailActionButton(input.pdfUrl, "Download PDF", EMAIL_NAVY));
  }

  return renderBrandedEmailCard({
    banner: "INVOICE",
    introHtml,
    linesHtml: lines,
    actionsHtml: actions.join(""),
    trackingPixelUrl: input.trackingPixelUrl,
  });
}
