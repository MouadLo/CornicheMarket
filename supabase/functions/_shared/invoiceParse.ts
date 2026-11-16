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
  "price_basis_text", "global_discount_text",
] as const;
// Drafts read before price_basis_text existed lack it: absent counts as null.
const optionalHeaderKeys = ["price_basis_text", "global_discount_text"] as const;
type ExtractedLine =
  & Record<Exclude<(typeof lineKeys)[number], "discount_text">, string | null>
  & { discount_text?: string | null };
export type InvoiceExtraction = Record<
  Exclude<(typeof headerKeys)[number], "price_basis_text" | "global_discount_text">,
  string | null
> & {
  price_basis_text?: string | null;
  global_discount_text?: string | null;
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

// Which printed total the line totals add up to: that is what the line prices are.
export function priceBasisFromTotals(
  lineTotalsSum: number | null,
  totals: { subtotal_ht: number | null; vat_total: number | null; total_ttc: number | null },
): PriceBasis | null {
  if (lineTotalsSum === null) return null;
  const near = (total: number | null) => total !== null && Math.abs(lineTotalsSum - total) <= 100;
  const ht = near(totals.subtotal_ht);
  const ttc = near(totals.total_ttc);
  if (ht && ttc) return totals.vat_total === 0 ? "ht" : null;
  return ht ? "ht" : ttc ? "ttc" : null;
}

export type LineDiscountPrinted =
  | { percent: number; cents: null }
  | { percent: null; cents: number };

// "10%", "-5 %", "٢٠٪", "7,5%" (a percentage of the line) or "5,00", "- 12.50 DH"
// (an amount off the line). Zero, empty or unreadable text is no discount (null).
export function invoiceDiscount(text: string | null | undefined): LineDiscountPrinted | null {
  const clean = normalizeInvoiceDigits((text ?? "").trim()).replace(/^[-−–]\s*/u, "").trim();
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

export function normalizeInvoice(extraction: InvoiceExtraction) {
  const totals = {
    subtotal_ht: invoiceMoneyCents(extraction.subtotal_ht),
    vat_total: invoiceMoneyCents(extraction.vat_total),
    total_ttc: invoiceMoneyCents(extraction.total_ttc),
  };
  const flags: InvoiceFlag[] = [];
  const lineTotals = extraction.lines.map((line) => invoiceMoneyCents(line.line_total_text));
  const allLineTotals = lineTotals.length > 0 &&
    lineTotals.every((value): value is number => value !== null);
  const lineTotalsSum = allLineTotals ? lineTotals.reduce((sum, value) => sum + (value ?? 0), 0) : null;
  // A discount on the whole invoice (remise globale) comes off the lines' sum.
  // An amount needs that sum to be known; a percentage does not.
  const globalText = extraction.global_discount_text?.trim() || null;
  const globalParsed = invoiceDiscount(globalText);
  const globalUsable = globalParsed &&
    (globalParsed.percent !== null ||
      (lineTotalsSum !== null && globalParsed.cents < lineTotalsSum))
    ? globalParsed : null;
  const afterGlobal = lineTotalsSum === null || !globalUsable ? null
    : globalUsable.percent !== null
      ? Math.round((lineTotalsSum * (10000 - Math.round(globalUsable.percent * 100))) / 10000)
      : lineTotalsSum - globalUsable.cents;
  // Lines may be priced HT or TTC: they only disagree with the invoice when
  // they add up to neither printed total (before or after the global discount).
  const printedTotals = [totals.subtotal_ht, totals.total_ttc].filter((value): value is number => value !== null);
  const matchesPrinted = (sum: number | null) =>
    sum !== null && printedTotals.some((total) => Math.abs(sum - total) <= 100);
  if (lineTotalsSum !== null && printedTotals.length > 0 &&
      !matchesPrinted(lineTotalsSum) && !matchesPrinted(afterGlobal)) flags.push("totals_mismatch");
  // The discount may already be inside the lines: then taking it off again is wrong.
  const globalCheck = !!globalUsable && printedTotals.length > 0 && !matchesPrinted(afterGlobal);

  // The column heading says it outright; otherwise the totals do. When the
  // two disagree, or neither says, the owner is asked in the review.
  const fromLabel = priceBasisFromLabel(extraction.price_basis_text);
  const fromTotals = priceBasisFromTotals(lineTotalsSum, totals) ??
    priceBasisFromTotals(afterGlobal, totals);
  const priceBasis = fromLabel && fromTotals && fromLabel !== fromTotals ? null : fromLabel ?? fromTotals;

  // One rate for the whole invoice when its lines agree, or the printed VAT over HT.
  const lineRates = extraction.lines.map((line) => invoiceVatPercent(line.vat_rate));
  const distinct = [...new Set(lineRates.filter((rate): rate is number => rate !== null))];
  let invoiceVat: number | null = distinct.length === 1 ? distinct[0] : null;
  if (invoiceVat === null && distinct.length === 0 && totals.subtotal_ht && totals.vat_total !== null) {
    const rate = Math.round((totals.vat_total * 100) / totals.subtotal_ht);
    if ([0, 7, 10, 14, 20].includes(rate)) invoiceVat = rate;
  }

  if (totals.subtotal_ht !== null && totals.vat_total !== null && totals.total_ttc !== null &&
      Math.abs(totals.subtotal_ht + totals.vat_total - totals.total_ttc) > 100 &&
      !flags.includes("totals_mismatch")) flags.push("totals_mismatch");

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
    const discount = invoiceDiscount(discountText);
    const grossTotal = quantity !== null && cost !== null ? Math.round(quantity * cost) : null;
    // An amount larger than the line itself is a misreading.
    const usable = discount && !(discount.cents !== null && grossTotal !== null && discount.cents > grossTotal)
      ? discount : null;
    // The printed line total shows which price it was worked from: it should
    // match the price less the discount. Otherwise the discount may already be
    // inside the unit price, and applying it again would cost too little.
    const printedTotal = invoiceMoneyCents(line.line_total_text);
    let discountCheck = false;
    if (usable && grossTotal !== null && printedTotal !== null) {
      const net = usable.percent !== null
        ? Math.round((grossTotal * (10000 - Math.round(usable.percent * 100))) / 10000)
        : grossTotal - usable.cents;
      discountCheck = Math.abs(net - printedTotal) > 100;
    }
    const billedQuantity = quantity !== null ? String(quantity) : "";
    const billedCost = cost !== null && cost <= 100000000
      ? String(Math.floor(cost / 100)) + "." + String(cost % 100).padStart(2, "0") : "";
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
      // The discount as printed, and as the app uses it: a percentage of the
      // line, or an amount off the whole line, both on the printed price basis.
      // discount_text without either value could not be read: the owner checks.
      discount_text: discountText,
      discount_percent: usable?.percent ?? null,
      discount_cents: usable?.cents ?? null,
      discount_check: discountCheck,
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
      // The discount on the whole invoice, as printed and as used (a percentage,
      // or an amount with the lines' sum it comes off). global_discount_text
      // without either could not be read; global_discount_check means the
      // printed totals do not match the lines less the discount.
      global_discount_text: globalText,
      global_discount_percent: globalUsable?.percent ?? null,
      global_discount_cents: globalUsable?.cents ?? null,
      lines_total_cents: globalUsable?.cents != null ? lineTotalsSum : null,
      global_discount_check: globalCheck,
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
