/**
 * App Store Review demo employee auth (Guideline 2.1(a)).
 * Fixed phone + OTP so Apple can sign in without receiving SMS.
 * Only this phone is special — all other employees keep normal Twilio OTP.
 */

export const APP_REVIEW_EMPLOYEE_PHONE = "9999999999";
/** Fixed code to put in App Store Connect → App Review Information. */
export const APP_REVIEW_OTP_CODE = "123456";

/** Same normalization as validate/send employee OTP (digits; drop leading US 1). */
export function normalizePhoneForLookup(phone: string): string {
  if (!phone) return phone;
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    return digits.slice(1);
  }
  return digits;
}

export function isAppReviewEmployeePhone(phone: string): boolean {
  return normalizePhoneForLookup(phone) === APP_REVIEW_EMPLOYEE_PHONE;
}
