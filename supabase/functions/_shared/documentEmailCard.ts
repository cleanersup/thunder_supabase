/**
 * Estimate and quick-quote email card.
 * The grey page, white card, navy banner, and navy footer match the design.
 * Reference labels such as "CONFIRMATION FOR CLIENT" are not rendered.
 */

export type DocumentKind = "estimate" | "quote";
export type EmailAudience = "client" | "owner";
export type EmailMoment = "sent" | "accepted";

export interface DocumentEmailContact {
  name: string;
  email: string;
  phone: string;
  address: string;
}

export interface DocumentEmailInput {
  kind: DocumentKind;
  audience: EmailAudience;
  moment: EmailMoment;
  companyName: string;
  /** First name used in "Hello …". */
  greetingName: string;
  /** Client first name, used when the owner is told who received or accepted it. */
  clientFirstName: string;
  documentNumber: string;
  dateLabel: string;
  serviceType: string;
  contact: DocumentEmailContact;
  pdfUrl: string | null;
  acceptUrl: string | null;
  trackingPixelUrl?: string | null;
  isUpdate?: boolean;
}

const NAVY = "#1e3a8a";
const GREEN = "#239445";
const PAGE = "#e6e6e6";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function personFirstName(fullName: string | null | undefined): string {
  const part = String(fullName || "").trim().split(/\s+/)[0] || "";
  return part;
}

export function formatPhoneDisplay(phone: string | null | undefined): string {
  const raw = String(phone || "").trim();
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  const local = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (local.length === 10) {
    return `(${local.slice(0, 3)})${local.slice(3, 6)}-${local.slice(6)}`;
  }
  return raw;
}

export function formatStreetAddress(parts: Array<string | null | undefined>): string {
  return parts
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(" , ");
}

/** Same short code the PDF prints: the first 8 characters of the id, uppercased. */
export function documentCode(id: string | null | undefined): string {
  const code = String(id || "").slice(0, 8).toUpperCase();
  return code;
}

export function todayLongDate(now = new Date()): string {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(now);
}

function bannerLabel(kind: DocumentKind): string {
  return kind === "quote" ? "QUOTE" : "ESTIMATE";
}

function numberLabel(kind: DocumentKind): string {
  return kind === "quote" ? "Quote Number" : "Estimate Number";
}

function acceptLabel(kind: DocumentKind): string {
  return kind === "quote" ? "Accept Quote" : "Accept Estimate";
}

function viewLabel(kind: DocumentKind): string {
  return kind === "quote" ? "View Quote" : "View Estimate";
}

function noun(kind: DocumentKind): string {
  return kind === "quote" ? "quote" : "estimate";
}

function bodyCopy(input: DocumentEmailInput): string {
  const company = input.companyName.trim() || "your cleaning company";
  const client = input.clientFirstName.trim() || "your client";
  const word = noun(input.kind);
  const updated = input.isUpdate ? "updated " : "";

  if (input.moment === "accepted" && input.audience === "client") {
    return `Thank you for accepting the ${word} from ${company}. Your acceptance has been confirmed, and the company has been notified.`;
  }
  if (input.moment === "accepted" && input.audience === "owner") {
    return `Great news ! ${client} has accepted your ${word}. You can view the accepted ${word} and its details in your Thunder Pro account.`;
  }
  if (input.audience === "owner") {
    return `Your ${updated}${word} has been successfully sent to ${client}. You can view the ${word} details in your Thunder Pro account.`;
  }
  return `${company} has sent you an ${updated}${word} for your requested services. Please download the attached PDF to review the details, or click the ${acceptLabel(input.kind)} button below to review and accept the ${word} online.`;
}

function detailLine(label: string, value: string): string {
  const shown = value.trim();
  if (!shown) return "";
  return `<p style="margin:0 0 6px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.4;font-weight:700;color:#111111;"><span>${escapeHtml(label)} :</span> ${escapeHtml(shown)}</p>`;
}

function button(href: string, label: string, background: string): string {
  return `<a href="${escapeHtml(href)}" style="display:inline-block;background-color:${background};color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;line-height:1;text-decoration:none;padding:14px 22px;border-radius:8px;margin:6px;">${escapeHtml(label)}</a>`;
}

export function renderDocumentEmail(input: DocumentEmailInput): string {
  const hello = input.greetingName.trim() || "there";
  const lines = [
    detailLine(numberLabel(input.kind), input.documentNumber),
    detailLine("Date", input.dateLabel),
    detailLine("Service Type", input.serviceType),
    `<p style="margin:0 0 14px 0;font-size:8px;line-height:8px;">&nbsp;</p>`,
    detailLine("Name", input.contact.name),
    detailLine("Email", input.contact.email),
    detailLine("Phone", input.contact.phone),
    detailLine("Address", input.contact.address),
  ].join("");

  const actions: string[] = [];
  if (input.moment === "sent" && input.audience === "client" && input.acceptUrl) {
    actions.push(button(input.acceptUrl, acceptLabel(input.kind), GREEN));
  }
  if (input.pdfUrl) {
    const label = input.moment === "sent" && input.audience === "client"
      ? viewLabel(input.kind)
      : "Download PDF";
    actions.push(button(input.pdfUrl, label, NAVY));
  }

  const year = new Date().getFullYear();
  const pixel = input.trackingPixelUrl
    ? `<img src="${escapeHtml(input.trackingPixelUrl)}" width="1" height="1" alt="" style="display:none;" />`
    : "";

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(bannerLabel(input.kind))}</title>
</head>
<body style="margin:0;padding:0;background-color:${PAGE};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${PAGE};">
<tr>
<td align="center" style="padding:28px 12px;">
<table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;background-color:#ffffff;border-radius:16px;overflow:hidden;">
<tr>
<td align="center" style="background-color:${NAVY};padding:22px 20px;">
<p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:22px;font-weight:700;letter-spacing:1.5px;color:#ffffff;">${bannerLabel(input.kind)}</p>
</td>
</tr>
<tr>
<td style="padding:28px 32px 8px 32px;font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;">
<p style="margin:0 0 14px 0;font-size:14px;line-height:1.5;">Hello ${escapeHtml(hello)},</p>
<p style="margin:0 0 22px 0;font-size:14px;line-height:1.55;">${escapeHtml(bodyCopy(input))}</p>
${lines}
</td>
</tr>
<tr>
<td align="center" style="padding:18px 20px 36px 20px;">
${actions.join("")}
</td>
</tr>
<tr>
<td align="center" style="background-color:${NAVY};padding:16px 18px;">
<p style="margin:0 0 4px 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.4;color:#ffffff;">Service provided by</p>
<p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.4;color:#ffffff;">© ${year} Thunder Pro Inc. | <a href="https://www.thunderpro.co" style="color:#ffffff;text-decoration:underline;">www.thunderpro.co</a></p>
</td>
</tr>
</table>
</td>
</tr>
</table>
${pixel}
</body>
</html>`;
}
