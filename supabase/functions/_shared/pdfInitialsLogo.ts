/**
 * Circle used on estimate and invoice PDFs when the company has no logo.
 * Two letters: the first letter of the first word and the first letter of the last word.
 * "Pedros Cleaning" → "PC".
 */

export function companyInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter((part) => /[A-Za-z0-9]/.test(part));
  const letter = (part: string) => (part.match(/[A-Za-z0-9]/)?.[0] ?? "").toUpperCase();
  if (parts.length === 0) return "";
  if (parts.length === 1) {
    return (parts[0].match(/[A-Za-z0-9]/g) ?? []).slice(0, 2).join("").toUpperCase();
  }
  return `${letter(parts[0])}${letter(parts[parts.length - 1])}`;
}

/** #1E3A8B */
const NAVY: [number, number, number] = [30, 58, 139];

interface InitialsLogoDoc {
  setFillColor: (r: number, g: number, b: number) => void;
  circle: (x: number, y: number, radius: number, style: string) => void;
  setTextColor: (r: number, g: number, b: number) => void;
  setFont: (font: string, style: string) => void;
  setFontSize: (size: number) => void;
  text: (text: string, x: number, y: number, options?: { align?: "center"; baseline?: "middle" }) => void;
}

/** Draws the circle at x,y with width and height `size` (mm). Returns false when the name has no letters. */
export function drawInitialsLogo(
  doc: InitialsLogoDoc,
  x: number,
  y: number,
  size: number,
  companyName: string,
): boolean {
  const letters = companyInitials(companyName);
  if (!letters) return false;

  const radius = size / 2;
  doc.setFillColor(NAVY[0], NAVY[1], NAVY[2]);
  doc.circle(x + radius, y + radius, radius, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(size * 1.45);
  doc.text(letters, x + radius, y + radius, { align: "center", baseline: "middle" });
  return true;
}
