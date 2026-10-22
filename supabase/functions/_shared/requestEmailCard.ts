/**
 * Request email card. Same shell as the estimate and invoice emails.
 * Reference titles such as "CONFIRMATION REQUEST FOR CLIENT" are not rendered.
 */

import {
  type DocumentEmailContact,
  emailDetailLine,
  escapeHtml,
  renderBrandedEmailCard,
} from "./documentEmailCard.ts";

export type RequestEmailKind = "received" | "new" | "converted";
export type RequestConversionTarget = "estimate" | "walkthrough" | "next";

export interface RequestEmailInput {
  kind: RequestEmailKind;
  companyName: string;
  greetingName: string;
  clientFirstName: string;
  conversionTarget?: RequestConversionTarget;
  dateLabel: string;
  serviceType: string;
  preferredDate: string;
  timePreferred: string;
  contact: DocumentEmailContact;
}

export function formatTimePreferred(value: string | null | undefined): string {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  if (raw === "am") return "Morning";
  if (raw === "pm") return "Afternoon";
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

export function formatRequestServiceType(value: string | null | undefined): string {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "residential") return "Residential";
  if (raw === "commercial") return "Commercial";
  if (!raw) return "";
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function banner(kind: RequestEmailKind): string {
  if (kind === "received") return "REQUEST RECEIVED";
  if (kind === "converted") return "REQUEST CONVERTED";
  return "NEW REQUEST";
}

function conversionPhrase(target: RequestConversionTarget | undefined): string {
  if (target === "walkthrough") return "a Walkthrough";
  if (target === "next") return "the next step";
  return "an Estimate";
}

function possessiveName(name: string): string {
  const shown = name.trim() || "Your client";
  return /s$/i.test(shown) ? `${shown}'` : `${shown}'s`;
}

function paragraph(text: string): string {
  return `<p style="margin:0 0 16px 0;font-size:14px;line-height:1.55;">${escapeHtml(text)}</p>`;
}

function bodyParagraphs(input: RequestEmailInput): string {
  const company = input.companyName.trim() || "your cleaning company";
  const client = input.clientFirstName.trim() || "Your client";

  if (input.kind === "received") {
    return [
      paragraph(`Thank you for contacting ${company} !`),
      paragraph("We've received your request, and our team will review the details and get in touch with you soon by text message, phone call, or email."),
      paragraph("We appreciate your interest and look forward to helping you!"),
    ].join("\n");
  }
  if (input.kind === "converted") {
    return paragraph(
      `${possessiveName(input.clientFirstName)} request has been successfully converted into ${conversionPhrase(input.conversionTarget)}. You can view the job details and manage the next steps in your Thunder Pro account.`,
    );
  }
  return paragraph(
    `${client} has successfully submitted a new request to your business. You can view the request details in your Thunder Pro account.`,
  );
}

export function renderRequestEmail(input: RequestEmailInput): string {
  const hello = input.greetingName.trim() || "there";
  const introHtml = `<p style="margin:0 0 14px 0;font-size:14px;line-height:1.5;">Hello ${escapeHtml(hello)},</p>
${bodyParagraphs(input)}`;

  const lines = input.kind === "received"
    ? ""
    : [
      emailDetailLine("Date", input.dateLabel),
      emailDetailLine("Service Type", input.serviceType),
      emailDetailLine("Preferred Date", input.preferredDate),
      emailDetailLine("Time Preferred", input.timePreferred),
      `<p style="margin:0 0 14px 0;font-size:8px;line-height:8px;">&nbsp;</p>`,
      emailDetailLine("Name", input.contact.name),
      emailDetailLine("Email", input.contact.email),
      emailDetailLine("Phone", input.contact.phone),
      emailDetailLine("Address", input.contact.address),
    ].join("");

  return renderBrandedEmailCard({
    banner: banner(input.kind),
    introHtml,
    linesHtml: lines,
    actionsHtml: "",
  });
}
