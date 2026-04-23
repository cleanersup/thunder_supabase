/**
 * Signup welcome SMS/email copy — single place to update Calendly, names, etc.
 * Keep in sync with product requirements.
 */
export const SIGNUP_WELCOME_SENDER_FIRST_NAME = "Javier";
export const SIGNUP_WELCOME_COMPANY_NAME = "Thunder Pro";
export const SIGNUP_WELCOME_CALENDLY_URL = "https://calendly.com/thunderpro-info/30min";
export const SIGNUP_WELCOME_FOLLOW_UP_NAME = "John Silva";

export const SIGNUP_WELCOME_EMAIL_SUBJECT = `Welcome to ${SIGNUP_WELCOME_COMPANY_NAME} — schedule your demo`;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Plain-text body for SMS (and email alt). */
export function buildWelcomePlainText(firstNameFromProfile: string | null | undefined): string {
  const fn = (firstNameFromProfile ?? "").trim() || "there";
  return (
    `Hi ${fn}, this is ${SIGNUP_WELCOME_SENDER_FIRST_NAME} from ${SIGNUP_WELCOME_COMPANY_NAME}. ` +
    `No rush but here is a link to schedule a 30 min demo to get the most out of your trial ${SIGNUP_WELCOME_CALENDLY_URL} . ` +
    `${SIGNUP_WELCOME_FOLLOW_UP_NAME} will follow up to you`
  );
}

/** HTML email — same message; Calendly URL is clickable. */
export function buildWelcomeEmailHtml(firstNameFromProfile: string | null | undefined): string {
  const fn = escapeHtml((firstNameFromProfile ?? "").trim() || "there");
  const url = SIGNUP_WELCOME_CALENDLY_URL;
  const safeUrl = escapeHtml(url);
  const plain = escapeHtml(buildWelcomePlainText(firstNameFromProfile));

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background-color:#f5f5f5">
<table cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f5f5f5;padding:20px 0">
  <tr>
    <td align="center">
      <table cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;background-color:#ffffff">
        <tr>
          <td align="center" style="background-color:#1e3a8a;padding:15px;color:#ffffff">
            <h1 style="margin:0;padding:0;font-size:22px;color:#ffffff">${SIGNUP_WELCOME_COMPANY_NAME}</h1>
            <p style="margin:5px 0 0 0;padding:0;font-size:14px;color:#ffffff">Welcome</p>
          </td>
        </tr>
        <tr>
          <td style="padding:24px">
            <p style="margin:0 0 16px 0;line-height:1.6;color:#333333;font-size:15px">Hi ${fn},</p>
            <p style="margin:0 0 16px 0;line-height:1.6;color:#333333;font-size:15px">
              This is ${escapeHtml(SIGNUP_WELCOME_SENDER_FIRST_NAME)} from ${escapeHtml(SIGNUP_WELCOME_COMPANY_NAME)}.
              No rush but here is a link to schedule a 30 min demo to get the most out of your trial:
              <a href="${safeUrl}" style="color:#1e40af;font-weight:600">${safeUrl}</a>.
              ${escapeHtml(SIGNUP_WELCOME_FOLLOW_UP_NAME)} will follow up to you.
            </p>
          </td>
        </tr>
        <tr>
          <td align="center" style="background-color:#1e3a8a;padding:15px;color:#ffffff">
            <p style="margin:0 0 5px 0;padding:0;font-size:12px;color:#ffffff">Service provided by</p>
            <p style="margin:0;padding:0;font-size:12px;color:#ffffff">© ${new Date().getFullYear()} Thunder Pro Inc. | <a href="https://www.thunderpro.co" style="color:#ffffff;text-decoration:underline">www.thunderpro.co</a></p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
<!-- plain-text fallback for simple clients -->
<pre style="display:none">${plain}</pre>
</body>
</html>`;
}
