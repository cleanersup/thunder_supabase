function parseLineItemTotal(item: unknown): number {
  if (!item || typeof item !== "object") return 0;
  const record = item as Record<string, unknown>;
  const direct = Number(record.total);
  if (!Number.isNaN(direct)) return direct;
  const price = Number(record.price ?? record.unit_price);
  const qtyRaw = record.qty ?? record.quantity ?? 1;
  const qty = Number(qtyRaw);
  if (Number.isNaN(price)) return 0;
  return (Number.isNaN(qty) ? 1 : qty) * price;
}

function parseLineItems(raw: unknown): { total: number }[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => ({ total: parseLineItemTotal(item) }));
}

function normalizeDiscountType(type: string | null | undefined): string | null {
  if (!type) return null;
  const t = type.toLowerCase();
  if (t === "percent" || t === "percentage") return "percentage";
  if (t === "fixed" || t === "amount") return "fixed";
  return type;
}

export interface InvoiceTotalsResult {
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  total: number;
  discountType: string | null;
  discountValue: number;
  taxRate: number;
}

/** Calculate invoice totals from DB fields — matches dashboard/swift-slate logic. */
export function calculateInvoiceTotals(invoice: {
  line_items?: unknown;
  discount_type?: string | null;
  discount_value?: number | null;
  tax_rate?: number | null;
  total?: unknown;
}): InvoiceTotalsResult {
  const lineItems = parseLineItems(invoice.line_items);
  const discountType = normalizeDiscountType(invoice.discount_type);
  const discountValue = Number(invoice.discount_value) || 0;
  const taxRate = Number(invoice.tax_rate) || 0;

  const subtotal = lineItems.reduce((s, i) => s + i.total, 0);
  // Percentage discount applies to positive service lines only (not deposit credits).
  const discountBase = lineItems.reduce((s, i) => s + (i.total > 0 ? i.total : 0), 0);
  const discountAmount = discountType === "percentage"
    ? discountBase * (discountValue / 100)
    : discountValue;
  const afterDiscount = subtotal - discountAmount;
  const taxAmount = afterDiscount * (taxRate / 100);
  const computedTotal = Math.round((afterDiscount + taxAmount) * 100) / 100;
  const storedTotal = Math.round((Number(invoice.total) || 0) * 100) / 100;

  return {
    subtotal: Math.round(subtotal * 100) / 100,
    discountAmount: Math.round(discountAmount * 100) / 100,
    taxAmount: Math.round(taxAmount * 100) / 100,
    total: storedTotal > 0 ? storedTotal : computedTotal,
    discountType,
    discountValue,
    taxRate,
  };
}

export function buildInvoiceTotalsSummaryHtml(
  totals: InvoiceTotalsResult,
  f: (n: number) => string,
): string {
  if (totals.discountAmount <= 0 && totals.taxAmount <= 0) return "";

  let rows = `
    <tr>
      <td style="padding:6px 0;color:#333333">Subtotal</td>
      <td style="padding:6px 0;text-align:right;color:#333333">${f(totals.subtotal)}</td>
    </tr>`;

  if (totals.discountAmount > 0) {
    const label = totals.discountType === "percentage"
      ? `Discount (${totals.discountValue}%)`
      : "Discount";
    rows += `
    <tr>
      <td style="padding:6px 0;color:#333333">${label}</td>
      <td style="padding:6px 0;text-align:right;color:#dc2626">-${f(totals.discountAmount)}</td>
    </tr>`;
  }

  if (totals.taxAmount > 0) {
    rows += `
    <tr>
      <td style="padding:6px 0;color:#333333">Tax (${totals.taxRate}%)</td>
      <td style="padding:6px 0;text-align:right;color:#333333">${f(totals.taxAmount)}</td>
    </tr>`;
  }

  return `
    <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:12px">
      <tr>
        <td>
          <table cellpadding="8" cellspacing="0" border="0" width="100%" style="border:1px solid #e5e7eb;background-color:#fafafa">
            <tbody>${rows}
            </tbody>
          </table>
        </td>
      </tr>
    </table>`;
}
