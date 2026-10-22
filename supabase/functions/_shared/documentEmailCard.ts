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

export const EMAIL_NAVY = "#1e3a8a";
export const EMAIL_GREEN = "#239445";
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

function bannerLabel(): string {
  return "ESTIMATE";
}

function numberLabel(): string {
  return "Estimate Number";
}

function acceptLabel(): string {
  return "Accept Estimate";
}

function viewLabel(): string {
  return "View Estimate";
}

function noun(): string {
  return "estimate";
}

function bodyCopy(input: DocumentEmailInput): string {
  const company = input.companyName.trim() || "your cleaning company";
  const client = input.clientFirstName.trim() || "your client";
  const word = noun();
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
  return `${company} has sent you an ${updated}${word} for your requested services. Please download the attached PDF to review the details, or click the ${acceptLabel()} button below to review and accept the ${word} online.`;
}

export function emailDetailLine(label: string, value: string): string {
  const shown = value.trim();
  if (!shown) return "";
  return `<p style="margin:0 0 6px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.4;font-weight:400;color:#111111;"><span style="font-weight:700;">${escapeHtml(label)} :</span> ${escapeHtml(shown)}</p>`;
}

export function emailActionButton(href: string, label: string, background: string): string {
  return `<a href="${escapeHtml(href)}" style="display:inline-block;background-color:${background};color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;line-height:1;text-decoration:none;padding:14px 22px;border-radius:4px;margin:6px;">${escapeHtml(label)}</a>`;
}

/** Grey page, white card, navy banner, and navy footer shared by document emails. */
export function renderBrandedEmailCard(input: {
  banner: string;
  introHtml: string;
  linesHtml: string;
  actionsHtml: string;
  trackingPixelUrl?: string | null;
}): string {
  const year = new Date().getFullYear();
  const pixel = input.trackingPixelUrl
    ? `<img src="${escapeHtml(input.trackingPixelUrl)}" width="1" height="1" alt="" style="display:none;" />`
    : "";
  const actionsRow = input.actionsHtml.trim()
    ? `<tr>
<td align="center" style="padding:18px 20px 36px 20px;">
${input.actionsHtml}
</td>
</tr>
`
    : "";

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(input.banner)}</title>
</head>
<body style="margin:0;padding:0;background-color:${PAGE};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${PAGE};">
<tr>
<td align="center" style="padding:28px 12px;">
<table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;background-color:#ffffff;border-radius:6px;overflow:hidden;">
<tr>
<td align="center" style="background-color:${EMAIL_NAVY};padding:22px 20px;">
<p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:22px;font-weight:700;letter-spacing:1.5px;color:#ffffff;">${escapeHtml(input.banner)}</p>
</td>
</tr>
<tr>
<td style="padding:28px 32px 8px 32px;font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;">
${input.introHtml}
${input.linesHtml}
</td>
</tr>
${actionsRow}<tr>
<td align="center" style="background-color:${EMAIL_NAVY};padding:16px 18px;">
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

export function renderDocumentEmail(input: DocumentEmailInput): string {
  const hello = input.greetingName.trim() || "there";
  const lines = [
    emailDetailLine(numberLabel(), input.documentNumber),
    emailDetailLine("Date", input.dateLabel),
    emailDetailLine("Service Type", input.serviceType),
    `<p style="margin:0 0 14px 0;font-size:8px;line-height:8px;">&nbsp;</p>`,
    emailDetailLine("Name", input.contact.name),
    emailDetailLine("Email", input.contact.email),
    emailDetailLine("Phone", input.contact.phone),
    emailDetailLine("Address", input.contact.address),
  ].join("");

  const actions: string[] = [];
  if (input.moment === "sent" && input.audience === "client" && input.acceptUrl) {
    actions.push(emailActionButton(input.acceptUrl, acceptLabel(), EMAIL_GREEN));
  }
  if (input.pdfUrl) {
    const label = input.moment === "sent" && input.audience === "client"
      ? viewLabel()
      : "Download PDF";
    actions.push(emailActionButton(input.pdfUrl, label, EMAIL_NAVY));
  }

  const introHtml = `<p style="margin:0 0 14px 0;font-size:14px;line-height:1.5;">Hello ${escapeHtml(hello)},</p>
<p style="margin:0 0 22px 0;font-size:14px;line-height:1.55;">${escapeHtml(bodyCopy(input))}</p>`;

  return renderBrandedEmailCard({
    banner: bannerLabel(),
    introHtml,
    linesHtml: lines,
    actionsHtml: actions.join(""),
    trackingPixelUrl: input.trackingPixelUrl,
  });
}
