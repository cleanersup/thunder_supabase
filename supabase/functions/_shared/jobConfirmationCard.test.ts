import assert from "node:assert/strict";
import test from "node:test";
import {
  clientJobConfirmedSms,
  employeeJobAssignedSms,
  isJobConfirmation,
  isJobReschedule,
  jobDepositLabel,
  jobFrequencyLabel,
  jobPropertyAddress,
  ownerJobConfirmedSms,
  renderJobNoticeEmail,
  isWithinOneHourReminderWindow,
  jobStartUtc,
  renderJobReminderEmail,
  renderJobRescheduleEmail,
  type JobNotice,
} from "./jobConfirmationCard.ts";

const notice: JobNotice = {
  companyName: "Clean Up Company",
  clientName: "Pedro Cisneros",
  clientEmail: "javiers058@gmail.com",
  clientPhone: "2134644428",
  address: jobPropertyAddress({
    street: "818 W Huntington Dr",
    city: "Arcadia",
    state: "CA",
    zip: "91007",
  }),
  dateLabel: "October 20, 2026",
  startTime: "8:30 AM",
  endTime: "11:00 AM",
  serviceType: "Residential",
  frequencyLabel: "One Time",
  depositRequired: true,
  depositAmount: 100,
  payDepositUrl: "https://dashboard.thunderpro.co/invoice/payment/deposit-token",
  pdfUrl: "https://portal.thunderpro.co/functions/v1/download-job-pdf?token=job",
};

test("owner confirmation names the client and offers the PDF", () => {
  const { subject, html } = renderJobNoticeEmail("owner", "Javier", notice);
  assert.match(subject, /The job for Pedro has been confirmed/);
  assert.match(html, />JOB CONFIRMED</);
  assert.match(html, /Hello Javier,/);
  assert.match(html, /The job for Pedro has been confirmed and assigned to your team/);
  assert.match(html, /<span style="font-weight:700;">Name :<\/span> Pedro Cisneros/);
  assert.match(html, /<span style="font-weight:700;">Phone :<\/span> \(213\)464-4428/);
  assert.match(html, /818 W Huntington Dr , Arcadia , CA, 91007/);
  assert.match(html, /Deposit :<\/span> \$100/);
  assert.match(html, /Download PDF/);
  assert.doesNotMatch(html, /Pay Deposit/);
  assert.doesNotMatch(html, /CONFIRMATION JOB/);
});

test("client with a deposit gets the contact block and both buttons", () => {
  const { html } = renderJobNoticeEmail("client", "Pedro", notice);
  assert.match(html, /Hello Pedro,/);
  assert.match(html, /Your job has been confirmed and assigned to our team/);
  assert.match(html, /Thank you for choosing Clean Up Company!/);
  assert.match(html, /Name :<\/span> Pedro Cisneros/);
  assert.match(html, /Frequency :<\/span> One Time/);
  assert.match(html, /Pay Deposit/);
  assert.match(html, /background-color:#239445/);
  assert.match(html, /Download PDF/);
  assert.match(html, /background-color:#1e3a8a/);
});

test("client without a deposit omits the contact block and the pay button", () => {
  const { html } = renderJobNoticeEmail("client", "Pedro", {
    ...notice,
    depositRequired: false,
    depositAmount: 0,
    payDepositUrl: null,
    pdfUrl: notice.pdfUrl,
  });
  assert.match(html, /Deposit :<\/span> No Required/);
  assert.doesNotMatch(html, /Name :/);
  assert.doesNotMatch(html, /javiers058@gmail.com/);
  assert.doesNotMatch(html, /Pay Deposit/);
  assert.match(html, /Download PDF/);
});

test("employee assignment has no deposit and no buttons", () => {
  const { subject, html } = renderJobNoticeEmail("employee", "Marcelo", notice);
  assert.match(subject, /You've been assigned a new job/);
  assert.match(html, />ASSIGNED JOB</);
  assert.match(html, /Hello Marcelo,/);
  assert.match(html, /You've been assigned a new job for Pedro/);
  assert.match(html, /Thunder Crew app/);
  assert.match(html, /Name :<\/span> Pedro Cisneros/);
  assert.match(html, /Address :<\/span>/);
  assert.doesNotMatch(html, /Email :/);
  assert.doesNotMatch(html, /Deposit :/);
  assert.doesNotMatch(html, /Download PDF/);
  assert.doesNotMatch(html, /Pay Deposit/);
});

test("labels are bold and values stay regular", () => {
  const { html } = renderJobNoticeEmail("owner", "Javier", notice);
  assert.match(html, /font-weight:700;">Start Time :<\/span> 8:30 AM/);
  assert.doesNotMatch(html, /<span[^>]*>8:30 AM<\/span>/);
});

test("owner cancellation uses the cancelled banner and the client contact", () => {
  const { subject, html } = renderJobNoticeEmail("owner", "Javier", notice, "cancelled");
  assert.match(subject, /Pedro's job has been canceled/);
  assert.match(html, />JOB CANCELLED</);
  assert.match(html, /Pedro's job has been canceled/);
  assert.match(html, /cancellation status in your Thunder Pro account/);
  assert.match(html, /Name :<\/span> Pedro Cisneros/);
  assert.match(html, /Deposit :<\/span> \$100/);
  assert.match(html, /Download PDF/);
  assert.doesNotMatch(html, /Pay Deposit/);
});

test("client cancellation names the company and keeps the deposit line", () => {
  const { html } = renderJobNoticeEmail("client", "Pedro", notice, "cancelled");
  assert.match(html, /Hello Pedro,/);
  assert.match(html, /Your job with Clean Up Company has been canceled/);
  assert.match(html, /Thank you for your understanding/);
  assert.match(html, /Download PDF/);
  assert.doesNotMatch(html, /Pay Deposit/);
});

test("deposit paid emails use the deposit banner for owner and client", () => {
  const owner = renderJobNoticeEmail("owner", "Javier", notice, "deposit_paid");
  const client = renderJobNoticeEmail("client", "Pedro", notice, "deposit_paid");
  assert.match(owner.html, />DEPOSIT PAID</);
  assert.match(owner.html, /Pedro has paid the deposit for the confirmed job/);
  assert.match(owner.html, /payment information in your Thunder Pro account/);
  assert.match(client.html, /Your deposit payment has been received/);
  assert.match(client.html, /Thank you for choosing Clean Up Company!/);
  assert.match(client.html, /Download PDF/);
  assert.doesNotMatch(client.html, /Pay Deposit/);
});

test("owner tomorrow reminder with a pending deposit shows the deposit and no buttons", () => {
  const { subject, html } = renderJobReminderEmail("owner", "Javier", notice, "pending");
  assert.match(subject, /Pedro's job is scheduled for tomorrow/);
  assert.match(html, />JOB REMINDER TOMORROW</);
  assert.match(html, /Hello Javier,/);
  assert.match(html, /This is a reminder that Pedro's job is scheduled for tomorrow/);
  assert.match(html, /Name :<\/span> Pedro Cisneros/);
  assert.match(html, /Pending Deposit :<\/span> \$100/);
  assert.doesNotMatch(html, /<span style="font-weight:700;">Deposit :<\/span>/);
  assert.doesNotMatch(html, /Pay Deposit/);
  assert.doesNotMatch(html, /Download PDF/);
  assert.doesNotMatch(html, /CONFIRMATION REMINDER/);
});

test("owner tomorrow reminder with a paid deposit omits the deposit line", () => {
  const { html } = renderJobReminderEmail("owner", "Javier", notice, "paid");
  assert.match(html, /Pedro's job is scheduled for tomorrow/);
  assert.match(html, /Frequency :<\/span> One Time/);
  assert.doesNotMatch(html, /Deposit/);
  assert.doesNotMatch(html, /Pay Deposit/);
  assert.doesNotMatch(html, /Download PDF/);
});

test("client tomorrow reminder with a pending deposit offers pay and the PDF", () => {
  const { subject, html } = renderJobReminderEmail("client", "Pedro", notice, "pending");
  assert.match(subject, /Your job is scheduled for tomorrow/);
  assert.match(html, /Hello Pedro,/);
  assert.match(html, /your job with Clean Up Company is scheduled for tomorrow/);
  assert.match(html, /Thank you for choosing Clean Up Company\./);
  assert.match(html, /Deposit :<\/span> \$100/);
  assert.doesNotMatch(html, /Pending Deposit/);
  assert.match(html, /Pay Deposit/);
  assert.match(html, /background-color:#239445/);
  assert.match(html, /Download PDF/);
  assert.match(html, /background-color:#1e3a8a/);
});

test("client tomorrow reminder with a paid deposit has no deposit line and no buttons", () => {
  const { html } = renderJobReminderEmail("client", "Pedro", notice, "paid");
  assert.match(html, /Thank you for choosing Clean Up Company\./);
  assert.match(html, /Name :<\/span> Pedro Cisneros/);
  assert.match(html, /Frequency :<\/span> One Time/);
  assert.doesNotMatch(html, /Deposit/);
  assert.doesNotMatch(html, /Pay Deposit/);
  assert.doesNotMatch(html, /Download PDF/);
});

test("owner today reminder with a pending deposit shows the deposit and no buttons", () => {
  const { subject, html } = renderJobReminderEmail("owner", "Javier", notice, "pending", "today");
  assert.match(subject, /Pedro's job is scheduled to start in one hour/);
  assert.match(html, />JOB REMINDER TODAY</);
  assert.match(html, /Hello Javier,/);
  assert.match(html, /scheduled to start in one hour/);
  assert.match(html, /Pending Deposit :<\/span> \$100/);
  assert.doesNotMatch(html, /<span style="font-weight:700;">Deposit :<\/span>/);
  assert.doesNotMatch(html, /Pay Deposit/);
  assert.doesNotMatch(html, /Download PDF/);
  assert.doesNotMatch(html, /CONFIRMATION REMINDER/);
});

test("client today reminder with a pending deposit offers pay and the PDF", () => {
  const { subject, html } = renderJobReminderEmail("client", "Pedro", notice, "pending", "today");
  assert.match(subject, /Your job is scheduled to start in one hour/);
  assert.match(html, /your job with Clean Up Company is scheduled to start in one hour/);
  assert.match(html, /Thank you for choosing Clean Up Company\./);
  assert.match(html, /Deposit :<\/span> \$100/);
  assert.match(html, /Pay Deposit/);
  assert.match(html, /Download PDF/);
});

test("today reminder with a paid deposit omits the deposit line and the buttons", () => {
  const owner = renderJobReminderEmail("owner", "Javier", notice, "paid", "today");
  const client = renderJobReminderEmail("client", "Pedro", notice, "paid", "today");
  assert.match(owner.html, />JOB REMINDER TODAY</);
  assert.match(client.html, /scheduled to start in one hour/);
  assert.doesNotMatch(owner.html, /Deposit/);
  assert.doesNotMatch(client.html, /Deposit/);
  assert.doesNotMatch(client.html, /Pay Deposit/);
  assert.doesNotMatch(client.html, /Download PDF/);
});

test("owner reschedule with a pending deposit shows the deposit and no buttons", () => {
  const { subject, html } = renderJobRescheduleEmail("owner", "Javier", notice, "pending");
  assert.match(subject, /Pedro's job has been rescheduled/);
  assert.match(html, />JOB RESCHEDULED</);
  assert.match(html, /Hello Javier,/);
  assert.match(html, /Pedro's job has been rescheduled\. You can review the updated date and time/);
  assert.match(html, /Pending Deposit :<\/span> \$100/);
  assert.doesNotMatch(html, /<span style="font-weight:700;">Deposit :<\/span>/);
  assert.doesNotMatch(html, /Pay Deposit/);
  assert.doesNotMatch(html, /Download PDF/);
  assert.doesNotMatch(html, /CONFIRMATION RESCHEDULE/);
});

test("client reschedule with a pending deposit offers pay and the PDF", () => {
  const { subject, html } = renderJobRescheduleEmail("client", "Pedro", notice, "pending");
  assert.match(subject, /Your job has been rescheduled/);
  assert.match(html, /Your job has been rescheduled by our team/);
  assert.match(html, /Thank you for choosing Clean Up Company!/);
  assert.match(html, /Deposit :<\/span> \$100/);
  assert.match(html, /Pay Deposit/);
  assert.match(html, /background-color:#239445/);
  assert.match(html, /Download PDF/);
});

test("reschedule with a paid deposit omits the deposit line and the buttons", () => {
  const owner = renderJobRescheduleEmail("owner", "Javier", notice, "paid");
  const client = renderJobRescheduleEmail("client", "Pedro", notice, "paid");
  assert.match(owner.html, /Pedro's job has been rescheduled/);
  assert.match(client.html, /Thank you for choosing Clean Up Company!/);
  assert.match(client.html, /Name :<\/span> Pedro Cisneros/);
  assert.doesNotMatch(owner.html, /Deposit/);
  assert.doesNotMatch(client.html, /Deposit/);
  assert.doesNotMatch(client.html, /Pay Deposit/);
  assert.doesNotMatch(client.html, /Download PDF/);
  assert.equal(isJobReschedule("upcoming", "upcoming"), true);
  assert.equal(isJobReschedule("missed", "upcoming"), true);
  assert.equal(isJobReschedule("draft", "upcoming"), false);
});

test("the today reminder is due one hour before the start", () => {
  const start = jobStartUtc("2026-10-20", "08:30", "America/New_York");
  assert.ok(start);
  assert.equal(start.toISOString(), "2026-10-20T12:30:00.000Z");
  const oneHourBefore = new Date(start.getTime() - 60 * 60 * 1000);
  assert.equal(isWithinOneHourReminderWindow(oneHourBefore, start), true);
  assert.equal(isWithinOneHourReminderWindow(new Date(oneHourBefore.getTime() - 11 * 60 * 1000), start), false);
  assert.equal(isWithinOneHourReminderWindow(new Date(start.getTime() - 30 * 60 * 1000), start), false);
  assert.equal(jobStartUtc("2026-10-20", null, "America/New_York"), null);
});

test("confirmation SMS follows the email sentences", () => {
  assert.match(clientJobConfirmedSms(notice), /your job has been confirmed and assigned to our team/);
  assert.match(clientJobConfirmedSms(notice), /Pay deposit: https:\/\/dashboard.thunderpro.co/);
  assert.match(ownerJobConfirmedSms(notice, "Javier"), /the job for Pedro has been confirmed/);
  assert.match(employeeJobAssignedSms(notice, "Marcelo"), /Thunder Crew app/);
  assert.equal(jobDepositLabel(false, 0), "No Required");
  assert.equal(jobFrequencyLabel("one_time", null), "One Time");
  assert.equal(isJobConfirmation("draft", "upcoming"), true);
  assert.equal(isJobConfirmation("draft", "today"), true);
  assert.equal(isJobConfirmation("upcoming", "today"), false);
});
