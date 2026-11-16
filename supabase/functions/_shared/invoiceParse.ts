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
  "unit_price_text", "line_total_text", "vat_rate", "discount_text",
] as const;
// Drafts read before discount_text existed lack it: absent counts as null.
const optionalLineKeys = ["discount_text"] as const;
const headerKeys = [
  "supplier_name", "invoice_number", "invoice_date", "subtotal_ht", "vat_total", "total_ttc",
  "price_basis_text", "global_discount_text", "stamp_duty_text", "net_to_pay_text",
] as const;
// Drafts read before these keys existed lack them: absent counts as null.
const optionalHeaderKeys = [
  "price_basis_text", "global_discount_text", "stamp_duty_text", "net_to_pay_text",
] as const;
type ExtractedLine =
  & Record<Exclude<(typeof lineKeys)[number], "discount_text">, string | null>
  & { discount_text?: string | null };
export type InvoiceExtraction = Record<
  Exclude<(typeof headerKeys)[number], (typeof optionalHeaderKeys)[number]>,
  string | null
> & {
  [K in (typeof optionalHeaderKeys)[number]]?: string | null;
} & {
  lines: ExtractedLine[];
};

// Every field is a plain string, "" when absent: a nullable type
// (["string", "null"]) counts toward the API's limit of 16 union-typed
// parameters per request, and this schema has more fields than that. Blanks
// become null again in blanksToNull, before anything reads them.
const plainStrings = (keys: readonly string[]) =>
  Object.fromEntries(keys.map((key) => [key, { type: "string" }]));

export const invoiceSchema = {
  type: "object",
  additionalProperties: false,
  required: [...headerKeys, "lines"],
  properties: {
    ...plainStrings(headerKeys),
    lines: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [...lineKeys],
        properties: plainStrings(lineKeys),
      },
    },
  },
};

function hasTexts<K extends string>(value: unknown, keys: readonly K[]): value is Record<K, string | null> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const fields = value as Record<string, unknown>;
  return keys.every((key) => fields[key] === null || typeof fields[key] === "string");
}

// The model answers "" for a value that is not printed: store null instead,
// as drafts read before this did. Anything that is not an object is left as is
// for isInvoiceExtraction to refuse.
export function blanksToNull(value: unknown): unknown {
  const clean = (fields: unknown) => {
    if (typeof fields !== "object" || fields === null || Array.isArray(fields)) return fields;
    return Object.fromEntries(
      Object.entries(fields).map(([key, field]) => [
        key,
        typeof field === "string" && field.trim() === "" ? null : field,
      ]),
    );
  };
  const header = clean(value);
  if (typeof header !== "object" || header === null || Array.isArray(header)) return header;
  const lines = (header as Record<string, unknown>).lines;
  return Array.isArray(lines) ? { ...header, lines: lines.map(clean) } : header;
}

export function isInvoiceExtraction(value: unknown): value is InvoiceExtraction {
  const required = headerKeys.filter((key) => !(optionalHeaderKeys as readonly string[]).includes(key));
  if (!hasTexts(value, required)) return false;
  for (const key of optionalHeaderKeys) {
    const optional = (value as Record<string, unknown>)[key];
    if (optional !== undefined && optional !== null && typeof optional !== "string") return false;
  }
  if (!("lines" in value)) return false;
  const requiredLine = lineKeys.filter((key) => !(optionalLineKeys as readonly string[]).includes(key));
  const optionalText = (line: object) => {
    const text = (line as Record<string, unknown>).discount_text;
    return text === undefined || text === null || typeof text === "string";
  };
  return Array.isArray(value.lines) && value.lines.length <= 500 &&
    value.lines.every((line) => hasTexts(line, requiredLine) && optionalText(line));
}

export type PriceBasis = "ht" | "ttc";

// "20%", "20 %", "٢٠٪", "20,00": a whole-number TVA rate (Morocco: 0, 7, 10, 14, 20).
export function invoiceVatPercent(text: string | null | undefined): number | null {
  const clean = normalizeInvoiceDigits((text ?? "").trim())
    .replace(/[%٪]/g, "").replace(/[,٫]/g, ".").trim();
  if (!/^\d{1,3}(?:\.0{1,2})?$/.test(clean)) return null;
  const value = Number(clean);
  return value >= 0 && value <= 100 ? value : null;
}

// What the unit price column heading says: "PU HT", "Prix unitaire TTC".
export function priceBasisFromLabel(label: string | null | undefined): PriceBasis | null {
  const text = (label ?? "").toLowerCase();
  const ttc = /\bttc\b|t\.t\.c|toutes? taxes|شامل|مع الضريبة|بالضريبة/u.test(text);
  const ht = /\bht\b|h\.t\b|hors taxes?|بدون|دون|قبل الضريبة/u.test(text);
  return ttc === ht ? null : ttc ? "ttc" : "ht";
}

// Which printed total the line totals add up to: that is what the line prices
// are. Both (only possible without TVA) is HT; neither is unknown.
export function priceBasisFromTotals(lineTotalsSum: number | null, totals: PrintedTotals): PriceBasis | null {
  const match = matchedTotal(lineTotalsSum, totals);
  if (match.ht && match.ttc) return totals.vat_total === 0 ? "ht" : null;
  return match.ht ? "ht" : match.ttc ? "ttc" : null;
}

export type LineDiscountPrinted =
  | { percent: number; cents: null }
  | { percent: null; cents: number };

// "10%", "-5 %", "٢٠٪", "7,5%" (a percentage) or "5,00", "- 12.50 DH", "24,24-"
// (an amount). Zero, empty or unreadable text is no discount (null).
export function invoiceDiscount(text: string | null | undefined): LineDiscountPrinted | null {
  const clean = normalizeInvoiceDigits((text ?? "").trim())
    .replace(/^[-−–]\s*/u, "").replace(/\s*[-−–]$/u, "").trim();
  if (!clean) return null;
  const percent = clean.match(/^(\d{1,3}(?:[.,٫]\d{1,2})?)\s*[%٪]$/u);
  if (percent) {
    const value = Number(percent[1].replace(/[,٫]/, "."));
    return value > 0 && value <= 100 ? { percent: value, cents: null } : null;
  }
  const cents = invoiceMoneyCents(clean);
  return cents !== null && cents > 0 ? { percent: null, cents } : null;
}

export type InvoiceFlag = "totals_mismatch" | "duplicate_invoice" | "unreadable_lines" | "unit_check";

// A printed billing unit other than "piece" (carton, pack, kg…): the billed
// quantity and price are not in stock units until the owner confirms them.
export function needsUnitConversion(billingUnit: string | null | undefined): boolean {
  const unit = billingUnit?.trim();
  return !!unit && !/^(pi[èe]ces?|unit[ée]s?|pcs?\.?|u\.?|قطعة|قطع|وحدة|وحدات)$/iu.test(unit);
}

// The invoice's printed totals, in centimes.
export type PrintedTotals = {
  subtotal_ht: number | null;
  vat_total: number | null;
  total_ttc: number | null;
  stamp_duty?: number | null;
  net_to_pay?: number | null;
};

const nearCents = (a: number, b: number) => Math.abs(a - b) <= 100;

// What the lines can be checked against. HT is the printed HT total. TTC is the
// printed TTC total, else HT + TVA, else net to pay less the stamp duty (timbre),
// which is a fee on cash payment, not part of the goods. A "TTC" that turns out
// to include the timbre is accepted too.
export function totalTargets(totals: PrintedTotals): { ht: number | null; ttc: number[] } {
  const stamp = totals.stamp_duty ?? null;
  const ttc = [
    totals.total_ttc,
    totals.subtotal_ht !== null && totals.vat_total !== null ? totals.subtotal_ht + totals.vat_total : null,
    totals.net_to_pay != null && stamp !== null ? totals.net_to_pay - stamp : null,
    totals.total_ttc !== null && stamp !== null ? totals.total_ttc - stamp : null,
  ].filter((value): value is number => value !== null);
  return { ht: totals.subtotal_ht, ttc: [...new Set(ttc)] };
}

// Which printed total (HT or TTC) a sum of lines matches, within 1 DH.
export function matchedTotal(
  sum: number | null,
  totals: PrintedTotals,
): { ht: boolean; ttc: boolean } {
  const targets = totalTargets(totals);
  return {
    ht: sum !== null && targets.ht !== null && nearCents(sum, targets.ht),
    ttc: sum !== null && targets.ttc.some((total) => nearCents(sum, total)),
  };
}

// A discount on the whole of `sum`: what it takes off, in centimes. Null when
// it cannot apply (an amount larger than the sum).
export function discountOff(sum: number, discount: LineDiscountPrinted): number | null {
  if (discount.percent !== null) return Math.round((sum * Math.round(discount.percent * 100)) / 10000);
  return discount.cents <= sum ? discount.cents : null;
}

export function normalizeInvoice(extraction: InvoiceExtraction) {
  const totals: Required<PrintedTotals> = {
    subtotal_ht: invoiceMoneyCents(extraction.subtotal_ht),
    vat_total: invoiceMoneyCents(extraction.vat_total),
    total_ttc: invoiceMoneyCents(extraction.total_ttc),
    stamp_duty: invoiceMoneyCents(extraction.stamp_duty_text ?? null),
    net_to_pay: invoiceMoneyCents(extraction.net_to_pay_text ?? null),
  };
  const flags: InvoiceFlag[] = [];
  // Printed line totals are after each line's own discount.
  const lineTotals = extraction.lines.map((line) => invoiceMoneyCents(line.line_total_text));
  const allLineTotals = lineTotals.length > 0 &&
    lineTotals.every((value): value is number => value !== null);
  const lineTotalsSum = allLineTotals ? lineTotals.reduce((sum, value) => sum + (value ?? 0), 0) : null;
  // A discount on the whole invoice (remise globale) comes off the lines' sum.
  const globalText = extraction.global_discount_text?.trim() || null;
  const globalParsed = invoiceDiscount(globalText);
  const globalOff = lineTotalsSum !== null && globalParsed ? discountOff(lineTotalsSum, globalParsed) : null;
  const afterGlobal = lineTotalsSum !== null && globalOff !== null ? lineTotalsSum - globalOff : null;

  // Lines may be priced HT or TTC, with or without the global discount: they
  // only disagree with the invoice when they match no printed total at all.
  const targets = totalTargets(totals);
  const hasTarget = targets.ht !== null || targets.ttc.length > 0;
  const before = matchedTotal(lineTotalsSum, totals);
  const after = matchedTotal(afterGlobal, totals);
  if (lineTotalsSum !== null && hasTarget && !before.ht && !before.ttc && !after.ht && !after.ttc)
    flags.push("totals_mismatch");

  // The column heading says it outright; otherwise the totals do. When the
  // two disagree, or neither says, the owner is asked in the review.
  const fromLabel = priceBasisFromLabel(extraction.price_basis_text);
  const fromTotals = priceBasisFromTotals(lineTotalsSum, totals) ?? priceBasisFromTotals(afterGlobal, totals);
  const priceBasis = fromLabel && fromTotals && fromLabel !== fromTotals ? null : fromLabel ?? fromTotals;

  // One rate for the whole invoice when its lines agree, or the printed VAT over HT.
  const lineRates = extraction.lines.map((line) => invoiceVatPercent(line.vat_rate));
  const distinct = [...new Set(lineRates.filter((rate): rate is number => rate !== null))];
  let invoiceVat: number | null = distinct.length === 1 ? distinct[0] : null;
  if (invoiceVat === null && distinct.length === 0 && totals.subtotal_ht && totals.vat_total !== null) {
    const rate = Math.round((totals.vat_total * 100) / totals.subtotal_ht);
    if ([0, 7, 10, 14, 20].includes(rate)) invoiceVat = rate;
  }

  // HT + TVA must give the printed TTC (possibly with the timbre in it).
  if (totals.subtotal_ht !== null && totals.vat_total !== null && totals.total_ttc !== null) {
    const sum = totals.subtotal_ht + totals.vat_total;
    const withStamp = totals.stamp_duty !== null && nearCents(sum + totals.stamp_duty, totals.total_ttc);
    if (!nearCents(sum, totals.total_ttc) && !withStamp && !flags.includes("totals_mismatch"))
      flags.push("totals_mismatch");
  }

  let unreadable = extraction.lines.length === 0;
  let unitCheck = false;
  const sourceLines = extraction.lines.map((line, index) => {
    const quantity = invoiceQuantity(line.quantity_billed);
    const cost = invoiceMoneyCents(line.unit_price_text);
    unreadable ||= !line.description?.trim() || quantity === null || cost === null;
    // A billed carton, pack or weight is not necessarily the catalog stock unit.
    const billingUnit = line.billing_unit?.trim() || null;
    const needsConversion = needsUnitConversion(billingUnit);
    unitCheck ||= needsConversion;
    const discountText = line.discount_text?.trim() || null;
    const lineTotal = lineTotals[index];
    const billedQuantity = quantity !== null ? String(quantity) : "";
    const cents = (value: number | null) => value !== null && value <= 100000000
      ? String(Math.floor(value / 100)) + "." + String(value % 100).padStart(2, "0") : "";
    const billedCost = cents(cost);
    return {
      description: line.description?.trim() ?? "",
      billed: [line.billed_text, line.unit_price_text, discountText, line.line_total_text]
        .filter(Boolean).join(" · "),
      billing_unit: billingUnit,
      // As printed, per billed unit (carton, kg…): the review converts them.
      billed_quantity: billedQuantity,
      billed_unit_cost: billedCost,
      // The rate printed for this line, else the invoice's single rate.
      vat_percent: lineRates[index] ?? invoiceVat,
      // The line's discount as printed ("10%", "24,24-"), and its printed total
      // after that discount: the review reads both and checks one against the other.
      discount_text: discountText,
      line_total: cents(lineTotal),
      quantity: needsConversion ? "" : billedQuantity,
      unit: "piece" as const,
      unit_cost: needsConversion ? "" : billedCost,
    };
  });
  if (unreadable) flags.push("unreadable_lines");
  if (unitCheck) flags.push("unit_check");
  return {
    totals: {
      ...totals,
      price_basis: priceBasis,
      vat_percent: invoiceVat,
      // As printed: the review reads it, checks it against the totals and
      // lets the owner correct it.
      global_discount_text: globalText,
    },
    flags,
    sourceLines,
  };
}

export function sameInvoiceHeader(
  a: { supplier_id: string | null; invoice_number: string | null },
  b: { supplier_id: string | null; invoice_number: string | null }
): boolean {
  const number = a.invoice_number?.trim().toLowerCase();
  return !!a.supplier_id && !!number && a.supplier_id === b.supplier_id &&
    number === b.invoice_number?.trim().toLowerCase();
}
