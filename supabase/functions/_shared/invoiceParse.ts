export function normalizeInvoiceDigits(text: string): string {
  return text
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6f0));
}

function decimalParts(text: string, decimals: number): string[] | null {
  const normalized = normalizeInvoiceDigits(text.trim())
    .replace(/[,٫]/g, ".")
    .replace(/[\u00a0\u202f٬]/g, " ");
  const [whole, fraction, ...extra] = normalized.split(".");
  if (extra.length || !/^(?:\d+|\d{1,3}(?: \d{3})+)$/.test(whole)) return null;
  if (fraction !== undefined && (!/^\d+$/.test(fraction) || fraction.length > decimals)) return null;
  return [whole.replace(/ /g, ""), fraction ?? ""];
}

export function invoiceMoneyCents(text: string | null): number | null {
  const clean = text?.trim().replace(/\s*(?:MAD|DHS?\.?|د\.?\s*م\.?|درهم)$/iu, "").trim();
  const parts = clean && decimalParts(clean, 2);
  if (!parts) return null;
  const value = Number(parts[0]) * 100 + Number(parts[1].padEnd(2, "0"));
  return Number.isSafeInteger(value) ? value : null;
}

export function invoiceQuantity(text: string | null): number | null {
  const parts = text && decimalParts(text, 3);
  if (!parts) return null;
  const quantity = Number(parts.join("."));
  return quantity > 0 && quantity < 1000000 ? quantity : null;
}

export function validInvoiceDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date.startsWith("0000")) return false;
  const parsed = new Date(date + "T00:00:00Z");
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === date;
}

const lineKeys = [
  "description", "billed_text", "quantity_billed", "billing_unit",
  "unit_price_text", "line_total_text", "vat_rate",
] as const;
const headerKeys = ["supplier_name", "invoice_number", "invoice_date", "subtotal_ht", "vat_total", "total_ttc"] as const;
type ExtractedLine = Record<(typeof lineKeys)[number], string | null>;
export type InvoiceExtraction = Record<(typeof headerKeys)[number], string | null> & {
  lines: ExtractedLine[];
};

const nullableStrings = (keys: readonly string[]) =>
  Object.fromEntries(keys.map((key) => [key, { type: ["string", "null"] }]));

export const invoiceSchema = {
  type: "object",
  additionalProperties: false,
  required: [...headerKeys, "lines"],
  properties: {
    ...nullableStrings(headerKeys),
    lines: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [...lineKeys],
        properties: nullableStrings(lineKeys),
      },
    },
  },
};

function hasTexts<K extends string>(value: unknown, keys: readonly K[]): value is Record<K, string | null> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const fields = value as Record<string, unknown>;
  return keys.every((key) => fields[key] === null || typeof fields[key] === "string");
}

export function isInvoiceExtraction(value: unknown): value is InvoiceExtraction {
  if (!hasTexts(value, headerKeys) || !("lines" in value)) return false;
  return Array.isArray(value.lines) && value.lines.length <= 500 &&
    value.lines.every((line) => hasTexts(line, lineKeys));
}

export type InvoiceFlag = "totals_mismatch" | "duplicate_invoice" | "unreadable_lines" | "unit_check";

export function normalizeInvoice(extraction: InvoiceExtraction) {
  const totals = {
    subtotal_ht: invoiceMoneyCents(extraction.subtotal_ht),
    vat_total: invoiceMoneyCents(extraction.vat_total),
    total_ttc: invoiceMoneyCents(extraction.total_ttc),
  };
  const flags: InvoiceFlag[] = [];
  const lineTotals = extraction.lines.map((line) => invoiceMoneyCents(line.line_total_text));
  const printed = totals.subtotal_ht ?? totals.total_ttc;
  if (
    printed !== null && lineTotals.length > 0 &&
    lineTotals.every((value): value is number => value !== null) &&
    Math.abs(lineTotals.reduce((sum, value) => sum + value, 0) - printed) > 100
  ) flags.push("totals_mismatch");

  if (totals.subtotal_ht !== null && totals.vat_total !== null && totals.total_ttc !== null &&
      Math.abs(totals.subtotal_ht + totals.vat_total - totals.total_ttc) > 100 &&
      !flags.includes("totals_mismatch")) flags.push("totals_mismatch");

  let unreadable = extraction.lines.length === 0;
  let unitCheck = false;
  const sourceLines = extraction.lines.map((line) => {
    const quantity = invoiceQuantity(line.quantity_billed);
    const cost = invoiceMoneyCents(line.unit_price_text);
    unreadable ||= !line.description?.trim() || quantity === null || cost === null;
    // A billed carton, pack or weight is not necessarily the catalog stock unit.
    const billingUnit = line.billing_unit?.trim() || null;
    const needsConversion = billingUnit !== null &&
      !/^(pi[èe]ces?|unit[ée]s?|pcs?\.?|u\.?|قطعة|قطع|وحدة|وحدات)$/iu.test(billingUnit);
    unitCheck ||= needsConversion;
    return {
      description: line.description?.trim() ?? "",
      billed: [line.billed_text, line.unit_price_text, line.line_total_text]
        .filter(Boolean).join(" · "),
      billing_unit: billingUnit,
      quantity: quantity !== null && !needsConversion ? String(quantity) : "",
      unit: "piece" as const,
      unit_cost: cost !== null && cost <= 100000000 && !needsConversion
        ? String(Math.floor(cost / 100)) + "." + String(cost % 100).padStart(2, "0") : "",
    };
  });
  if (unreadable) flags.push("unreadable_lines");
  if (unitCheck) flags.push("unit_check");
  return { totals, flags, sourceLines };
}

export function sameInvoiceHeader(
  a: { supplier_id: string | null; invoice_number: string | null },
  b: { supplier_id: string | null; invoice_number: string | null }
): boolean {
  const number = a.invoice_number?.trim().toLowerCase();
  return !!a.supplier_id && !!number && a.supplier_id === b.supplier_id &&
    number === b.invoice_number?.trim().toLowerCase();
}
