import assert from "node:assert/strict";
import test from "node:test";
import {
  clientJobConfirmedSms,
  employeeJobAssignedSms,
  isJobConfirmation,
  jobDepositLabel,
  jobFrequencyLabel,
  jobPropertyAddress,
  ownerJobConfirmedSms,
  renderJobNoticeEmail,
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
