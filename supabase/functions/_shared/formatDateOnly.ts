/**
 * Format a calendar date (YYYY-MM-DD) without timezone day shift.
 * Matches frontend parseDateOnly / formatDateOnly (thunder_dashboard, swift-slate).
 */
export function formatDateOnlyLong(
  dateStr: string | null | undefined,
  timezone?: string,
): string {
  if (!dateStr) return "N/A";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr).trim());
  if (!m) return String(dateStr);

  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return String(dateStr);

  const dateAtMidday = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));

  if (timezone) {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "long",
      day: "numeric",
    }).format(dateAtMidday);
  }

  const MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  return `${MONTHS[month - 1]} ${day}, ${year}`;
}
