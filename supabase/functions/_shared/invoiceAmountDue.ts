import { calculateInvoiceTotals } from "./invoiceCalculations.ts";

/** Amount due for invoice email/PDF — respects discount, tax, and deposit credits. */
export function computeInvoiceAmountDue(invoice: {
  line_items?: unknown;
  discount_type?: string | null;
  discount_value?: number | null;
  tax_rate?: number | null;
  total?: unknown;
}): number {
  return calculateInvoiceTotals(invoice).total;
}
