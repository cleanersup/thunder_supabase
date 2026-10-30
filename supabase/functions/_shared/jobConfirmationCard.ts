/**
 * Job confirmation card for the owner, the client, and the assigned employee.
 * Reference titles such as "CONFIRMATION JOB FOR OWNER" are not rendered.
 */

import {
  EMAIL_GREEN,
  EMAIL_NAVY,
  emailActionButton,
  emailDetailLine,
  escapeHtml,
  formatPhoneDisplay,
  formatStreetAddress,
  personFirstName,
  renderBrandedEmailCard,
} from "./documentEmailCard.ts";

export type JobNoticeAudience = "owner" | "client" | "employee";
export type JobNoticeMoment = "confirmed" | "cancelled" | "deposit_paid";
export type JobReminderDeposit = "pending" | "paid";
export type JobReminderWhen = "tomorrow" | "today";

export interface JobNotice {
  companyName: string;
  clientName: string;
  clientEmail: string;
  clientPhone: string;
  address: string;
  dateLabel: string;
  startTime: string;
  endTime: string;
  serviceType: string;
  frequencyLabel: string;
  depositRequired: boolean;
  depositAmount: number | null;
  payDepositUrl: string | null;
  pdfUrl: string | null;
}

const RESCHEDULE_FROM = new Set(["upcoming", "today", "ongoing", "missed"]);

export function isJobReschedule(previousStatus: string | null | undefined, newStatus: string): boolean {
  const next = String(newStatus || "").toLowerCase();
  if (next !== "upcoming" && next !== "today") return false;
  return RESCHEDULE_FROM.has(String(previousStatus || "").toLowerCase());
}

export function isJobConfirmation(previousStatus: string | null | undefined, newStatus: string): boolean {
  if (newStatus !== "upcoming" && newStatus !== "today") return false;
  const previous = previousStatus || "";
  return previous === "" || previous === "draft" || previous === "scheduled";
}

export function jobServiceLabel(value: string | null | undefined): string {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
}

export function jobFrequencyLabel(
  jobType: string | null | undefined,
  frequency: string | null | undefined,
): string {
  if ((jobType || "one_time") !== "recurring") return "One Time";
  const key = String(frequency || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
  if (key === "daily") return "Daily";
  if (key === "weekly" || key === "every_two_weeks") return "Weekly";
  if (key === "monthly") return "Monthly";
  if (!key) return "One Time";
  return key
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function formatJobClock(timeStr: string | null | undefined): string {
  const raw = String(timeStr || "").trim();
  if (!raw) return "";
  if (/[ap]m/i.test(raw)) return raw;
  const match = /^(\d{1,2}):(\d{2})/.exec(raw);
  if (!match) return raw;
  const hour = Number(match[1]);
  if (!Number.isFinite(hour)) return raw;
  const suffix = hour >= 12 ? "PM" : "AM";
  const display = hour % 12 || 12;
  return `${display}:${match[2]} ${suffix}`;
}

export function jobHasDeposit(
  required: boolean | null | undefined,
  amount: number | null | undefined,
): boolean {
  if (!required) return false;
  const value = Number(amount ?? 0);
  return Number.isFinite(value) && value > 0;
}

export function jobDepositLabel(
  required: boolean | null | undefined,
  amount: number | null | undefined,
): string {
  if (!jobHasDeposit(required, amount)) return "No Required";
  const rounded = Math.round(Number(amount) * 100) / 100;
  return Number.isInteger(rounded) ? `$${rounded}` : `$${rounded.toFixed(2)}`;
}

export function jobPropertyAddress(parts: {
  street?: string | null;
  apt?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
}): string {
  const street = [parts.street, parts.apt]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(" ");
  const stateZip = [parts.state, parts.zip]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(", ");
  return formatStreetAddress([street, parts.city, stateZip]);
}

function companyOf(notice: JobNotice): string {
  return notice.companyName.trim() || "your cleaning company";
}

function clientOf(notice: JobNotice): string {
  return personFirstName(notice.clientName) || "your client";
}

function scheduleLines(notice: JobNotice, includeDeposit: boolean): string {
  const lines = [
    emailDetailLine("Date", notice.dateLabel),
    emailDetailLine("Start Time", notice.startTime),
    emailDetailLine("End Time", notice.endTime),
    emailDetailLine("Service Type", notice.serviceType),
    emailDetailLine("Frequency", notice.frequencyLabel),
  ];
  if (includeDeposit) {
    lines.push(emailDetailLine("Deposit", jobDepositLabel(notice.depositRequired, notice.depositAmount)));
  }
  return lines.join("");
}

function contactLines(notice: JobNotice, includeReach: boolean): string {
  const lines = [
    emailDetailLine("Name", notice.clientName),
    includeReach ? emailDetailLine("Email", notice.clientEmail) : "",
    includeReach ? emailDetailLine("Phone", formatPhoneDisplay(notice.clientPhone)) : "",
    emailDetailLine("Address", notice.address),
  ];
  return lines.join("");
}

function paragraphs(audience: JobNoticeAudience, notice: JobNotice, moment: JobNoticeMoment): string[] {
  const company = companyOf(notice);
  const client = clientOf(notice);
  if (moment === "cancelled" && audience === "owner") {
    return [
      `${client}'s job has been canceled.`,
      "You can review the job details and cancellation status in your Thunder Pro account.",
    ];
  }
  if (moment === "cancelled") {
    return [
      `Your job with ${company} has been canceled. If you have any questions regarding the cancellation or your deposit, please feel free to contact our team.`,
      "Thank you for your understanding.",
    ];
  }
  if (moment === "deposit_paid" && audience === "owner") {
    return [
      `${client} has paid the deposit for the confirmed job.`,
      "The job has been assigned to your team. You can view the job details and payment information in your Thunder Pro account.",
    ];
  }
  if (moment === "deposit_paid") {
    return [
      "Your deposit payment has been received, and your job is confirmed and assigned to our team.",
      `Thank you for choosing ${company}! We look forward to providing you with great service.`,
    ];
  }
  if (audience === "owner") {
    return [
      `The job for ${client} has been confirmed and assigned to your team. You can view the job details in your Thunder Pro account.`,
    ];
  }
  if (audience === "employee") {
    return [
      `You've been assigned a new job for ${client}. Please open your Thunder Crew app to review the job details and schedule.`,
    ];
  }
  return [
    "Your job has been confirmed and assigned to our team.",
    `Thank you for choosing ${company}! We look forward to providing you with great service.`,
  ];
}

function subjectFor(audience: JobNoticeAudience, notice: JobNotice, moment: JobNoticeMoment): string {
  const company = companyOf(notice);
  const client = clientOf(notice);
  if (moment === "cancelled" && audience === "owner") return `${client}'s job has been canceled — ${company}`;
  if (moment === "cancelled") return `Your job has been canceled — ${company}`;
  if (moment === "deposit_paid" && audience === "owner") return `${client} has paid the deposit — ${company}`;
  if (moment === "deposit_paid") return `Your deposit payment has been received — ${company}`;
  if (audience === "owner") return `The job for ${client} has been confirmed — ${company}`;
  if (audience === "employee") return `You've been assigned a new job — ${company}`;
  return `Your job has been confirmed — ${company}`;
}

function bannerFor(audience: JobNoticeAudience, moment: JobNoticeMoment): string {
  if (moment === "cancelled") return "JOB CANCELLED";
  if (moment === "deposit_paid") return "DEPOSIT PAID";
  return audience === "employee" ? "ASSIGNED JOB" : "JOB CONFIRMED";
}

function reminderParagraphs(
  audience: "owner" | "client",
  notice: JobNotice,
  when: JobReminderWhen,
): string[] {
  const company = companyOf(notice);
  const client = clientOf(notice);
  const timing = when === "today" ? "to start in one hour" : "for tomorrow";
  if (audience === "owner") {
    return [
      `This is a reminder that ${client}'s job is scheduled ${timing}. You can review the job details and schedule in your Thunder Pro account to ensure everything is ready.`,
    ];
  }
  return [
    `This is a friendly reminder that your job with ${company} is scheduled ${timing}. We look forward to providing you with great service!`,
    `Thank you for choosing ${company}.`,
  ];
}

function reminderScheduleLines(
  notice: JobNotice,
  audience: "owner" | "client",
  deposit: JobReminderDeposit,
): string {
  const lines = [
    emailDetailLine("Date", notice.dateLabel),
    emailDetailLine("Start Time", notice.startTime),
    emailDetailLine("End Time", notice.endTime),
    emailDetailLine("Service Type", notice.serviceType),
    emailDetailLine("Frequency", notice.frequencyLabel),
  ];
  if (deposit === "pending" && audience === "owner") {
    lines.push(emailDetailLine("Pending Deposit", jobDepositLabel(notice.depositRequired, notice.depositAmount)));
  }
  if (deposit === "pending" && audience === "client") {
    lines.push(emailDetailLine("Deposit", jobDepositLabel(notice.depositRequired, notice.depositAmount)));
  }
  return lines.join("");
}

export function renderJobReminderEmail(
  audience: "owner" | "client",
  greetingName: string,
  notice: JobNotice,
  deposit: JobReminderDeposit,
  when: JobReminderWhen = "tomorrow",
): { subject: string; html: string } {
  const hello = greetingName.trim() || "there";
  const company = companyOf(notice);
  const client = clientOf(notice);
  const copy = reminderParagraphs(audience, notice, when);
  const introHtml = `<p style="margin:0 0 14px 0;font-size:14px;line-height:1.5;">Hello ${escapeHtml(hello)},</p>
${copy.map((text, index) => {
    const margin = index === copy.length - 1 ? "0 0 22px 0" : "0 0 14px 0";
    return `<p style="margin:${margin};font-size:14px;line-height:1.55;">${escapeHtml(text)}</p>`;
  }).join("")}`;

  const contact = contactLines(notice, true);
  const schedule = reminderScheduleLines(notice, audience, deposit);
  const spacer = `<p style="margin:0 0 14px 0;font-size:8px;line-height:8px;">&nbsp;</p>`;
  const actions: string[] = [];
  if (audience === "client" && deposit === "pending" && notice.payDepositUrl) {
    actions.push(emailActionButton(notice.payDepositUrl, "Pay Deposit", EMAIL_GREEN));
  }
  if (audience === "client" && deposit === "pending" && notice.pdfUrl) {
    actions.push(emailActionButton(notice.pdfUrl, "Download PDF", EMAIL_NAVY));
  }

  const timing = when === "today" ? "to start in one hour" : "for tomorrow";
  const subject = audience === "owner"
    ? `${client}'s job is scheduled ${timing} — ${company}`
    : `Your job is scheduled ${timing} — ${company}`;

  return {
    subject,
    html: renderBrandedEmailCard({
      banner: when === "today" ? "JOB REMINDER TODAY" : "JOB REMINDER TOMORROW",
      introHtml,
      linesHtml: `${contact}${spacer}${schedule}`,
      actionsHtml: actions.join(""),
    }),
  };
}

function rescheduleParagraphs(audience: "owner" | "client", notice: JobNotice): string[] {
  const company = companyOf(notice);
  const client = clientOf(notice);
  if (audience === "owner") {
    return [
      `${client}'s job has been rescheduled. You can review the updated date and time in your Thunder Pro account.`,
    ];
  }
  return [
    "Your job has been rescheduled by our team. Please review the updated date and time for your service.",
    `Thank you for choosing ${company}! We look forward to providing you with great service.`,
  ];
}

export function renderJobRescheduleEmail(
  audience: "owner" | "client",
  greetingName: string,
  notice: JobNotice,
  deposit: JobReminderDeposit,
): { subject: string; html: string } {
  const hello = greetingName.trim() || "there";
  const company = companyOf(notice);
  const client = clientOf(notice);
  const copy = rescheduleParagraphs(audience, notice);
  const introHtml = `<p style="margin:0 0 14px 0;font-size:14px;line-height:1.5;">Hello ${escapeHtml(hello)},</p>
${copy.map((text, index) => {
    const margin = index === copy.length - 1 ? "0 0 22px 0" : "0 0 14px 0";
    return `<p style="margin:${margin};font-size:14px;line-height:1.55;">${escapeHtml(text)}</p>`;
  }).join("")}`;

  const contact = contactLines(notice, true);
  const schedule = reminderScheduleLines(notice, audience, deposit);
  const spacer = `<p style="margin:0 0 14px 0;font-size:8px;line-height:8px;">&nbsp;</p>`;
  const actions: string[] = [];
  if (audience === "client" && deposit === "pending" && notice.payDepositUrl) {
    actions.push(emailActionButton(notice.payDepositUrl, "Pay Deposit", EMAIL_GREEN));
  }
  if (audience === "client" && deposit === "pending" && notice.pdfUrl) {
    actions.push(emailActionButton(notice.pdfUrl, "Download PDF", EMAIL_NAVY));
  }

  const subject = audience === "owner"
    ? `${client}'s job has been rescheduled — ${company}`
    : `Your job has been rescheduled — ${company}`;

  return {
    subject,
    html: renderBrandedEmailCard({
      banner: "JOB RESCHEDULED",
      introHtml,
      linesHtml: `${contact}${spacer}${schedule}`,
      actionsHtml: actions.join(""),
    }),
  };
}

export function renderJobNoticeEmail(
  audience: JobNoticeAudience,
  greetingName: string,
  notice: JobNotice,
  moment: JobNoticeMoment = "confirmed",
): { subject: string; html: string } {
  const hello = greetingName.trim() || "there";
  const copy = paragraphs(audience, notice, moment);
  const introHtml = `<p style="margin:0 0 14px 0;font-size:14px;line-height:1.5;">Hello ${escapeHtml(hello)},</p>
${copy.map((text, index) => {
    const margin = index === copy.length - 1 ? "0 0 22px 0" : "0 0 14px 0";
    return `<p style="margin:${margin};font-size:14px;line-height:1.55;">${escapeHtml(text)}</p>`;
  }).join("")}`;

  const hasDeposit = jobHasDeposit(notice.depositRequired, notice.depositAmount);
  const followUp = moment === "cancelled" || moment === "deposit_paid";
  const showClientContact = followUp
    ? audience !== "employee"
    : audience === "owner" || (audience === "client" && hasDeposit);
  const contact = showClientContact
    ? contactLines(notice, true)
    : audience === "employee"
      ? contactLines(notice, false)
      : "";
  const schedule = scheduleLines(notice, audience !== "employee");
  const spacer = contact
    ? `<p style="margin:0 0 14px 0;font-size:8px;line-height:8px;">&nbsp;</p>`
    : "";

  const actions: string[] = [];
  if (!followUp && audience === "client" && hasDeposit && notice.payDepositUrl) {
    actions.push(emailActionButton(notice.payDepositUrl, "Pay Deposit", EMAIL_GREEN));
  }
  if (audience !== "employee" && notice.pdfUrl) {
    actions.push(emailActionButton(notice.pdfUrl, "Download PDF", EMAIL_NAVY));
  }

  const banner = bannerFor(audience, moment);
  return {
    subject: subjectFor(audience, notice, moment),
    html: renderBrandedEmailCard({
      banner,
      introHtml,
      linesHtml: `${contact}${spacer}${schedule}`,
      actionsHtml: actions.join(""),
    }),
  };
}

function datedParts(notice: JobNotice): string {
  const parts = [
    notice.dateLabel ? `Date: ${notice.dateLabel}.` : "",
    notice.startTime ? `Start Time: ${notice.startTime}.` : "",
    notice.endTime ? `End Time: ${notice.endTime}.` : "",
  ].filter(Boolean);
  return parts.length ? ` ${parts.join(" ")}` : "";
}

/** True when `now` is within 10 minutes of one hour before `startUtc`. */
export function isWithinOneHourReminderWindow(now: Date, startUtc: Date): boolean {
  const oneHourBefore = startUtc.getTime() - 60 * 60 * 1000;
  const timeDiff = now.getTime() - oneHourBefore;
  return timeDiff >= -10 * 60 * 1000 && timeDiff <= 10 * 60 * 1000;
}

function wallClockUtc(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  let hour = read("hour");
  const extraDay = hour === 24 ? 1 : 0;
  if (hour === 24) hour = 0;
  return Date.UTC(read("year"), read("month") - 1, read("day") + extraDay, hour, read("minute"), read("second"));
}

/** Owner-local scheduled date and start time as a UTC instant. */
export function jobStartUtc(
  dateStr: string | null | undefined,
  timeStr: string | null | undefined,
  timeZone: string,
): Date | null {
  const date = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr || "").trim());
  const time = /^(\d{1,2}):(\d{2})/.exec(String(timeStr || "").trim());
  if (!date || !time) return null;
  const zone = timeZone.trim() || "America/New_York";
  const year = Number(date[1]);
  const month = Number(date[2]);
  const day = Number(date[3]);
  const hour = Number(time[1]);
  const minute = Number(time[2]);
  if (hour > 23 || minute > 59) return null;
  let utc = Date.UTC(year, month - 1, day, hour, minute, 0);
  try {
    for (let i = 0; i < 2; i += 1) {
      const offset = wallClockUtc(new Date(utc), zone) - utc;
      utc = Date.UTC(year, month - 1, day, hour, minute, 0) - offset;
    }
  } catch {
    return null;
  }
  return new Date(utc);
}

export function clientJobConfirmedSms(notice: JobNotice): string {
  const name = personFirstName(notice.clientName) || "there";
  const address = notice.address ? ` Address: ${notice.address}.` : "";
  const pay = jobHasDeposit(notice.depositRequired, notice.depositAmount) && notice.payDepositUrl
    ? ` Pay deposit: ${notice.payDepositUrl}`
    : "";
  return `${companyOf(notice)}: Hi ${name}, your job has been confirmed and assigned to our team.${datedParts(notice)}${address}${pay}`;
}

export function ownerJobConfirmedSms(notice: JobNotice, ownerFirstName: string): string {
  const name = ownerFirstName.trim() || "there";
  return `${companyOf(notice)}: Hi ${name}, the job for ${clientOf(notice)} has been confirmed and assigned to your team.${datedParts(notice)}`;
}

export function employeeJobAssignedSms(notice: JobNotice, employeeFirstName: string): string {
  const name = employeeFirstName.trim() || "there";
  const address = notice.address ? ` Address: ${notice.address}.` : "";
  return `${companyOf(notice)}: Hi ${name}, you've been assigned a new job for ${clientOf(notice)}. Please open your Thunder Crew app to review the job details and schedule.${datedParts(notice)}${address}`;
}
