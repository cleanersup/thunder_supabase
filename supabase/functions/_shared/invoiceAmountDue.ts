function parseLineItemTotal(item: unknown): number {
  if (!item || typeof item !== "object") return 0;
  const record = item as Record<string, unknown>;
  const direct = Number(record.total);
  if (!Number.isNaN(direct)) return direct;
  const price = Number(record.price);
  const qtyRaw = record.qty ?? record.quantity ?? 1;
  const qty = Number(qtyRaw);
  if (Number.isNaN(price)) return 0;
  return (Number.isNaN(qty) ? 1 : qty) * price;
}

function hasJobDepositCreditLine(lineItems: unknown): boolean {
  if (!Array.isArray(lineItems)) return false;
  return lineItems.some((item) => {
    const desc = String((item as Record<string, unknown>)?.description ?? "");
    return desc.toLowerCase().includes("deposit paid");
  });
}

/** Amount due for invoice email/PDF — aligns footer with line items on job balance invoices. */
export function computeInvoiceAmountDue(invoice: {
  line_items?: unknown;
  total?: unknown;
}): number {
  const storedTotal = Math.round((Number(invoice.total) || 0) * 100) / 100;
  const lineItems = invoice.line_items;

  if (!Array.isArray(lineItems) || lineItems.length === 0) {
    return storedTotal;
  }

  if (hasJobDepositCreditLine(lineItems)) {
    const lineSum = lineItems.reduce((sum, item) => sum + parseLineItemTotal(item), 0);
    return Math.round(lineSum * 100) / 100;
  }

  return storedTotal;
}
