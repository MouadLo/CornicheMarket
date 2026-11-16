import {
  invoiceDiscount,
  invoiceMoneyCents,
  invoiceQuantity,
  needsUnitConversion,
  type InvoiceFlag,
  type PriceBasis,
} from "@/supabase/functions/_shared/invoiceParse";
import { centsToDisplay, lineTotalCents } from "@/src/lib/money";
import type { ProductUnit } from "@/src/lib/products/queries";
import {
  isWeightBillingUnit,
  parseUnitsPerBillingUnit,
  unitsFromBillingUnit,
  unitsFromDescription,
} from "@/src/lib/stock/packs";
import { convertUnitCostCents, type GlobalDiscount, type LineDiscount } from "@/src/lib/stock/vat";
import { supabase } from "@/src/lib/supabase/client";

export type InvoiceSourceLine = {
  description: string;
  billed: string;
  billing_unit?: string | null;
  // As printed per billed unit; absent on drafts read before part 3.
  billed_quantity?: string;
  billed_unit_cost?: string;
  // TVA rate printed for the line (or the invoice's single rate); absent on older drafts.
  vat_percent?: number | null;
  // The line's discount (remise) as printed: "10%" off the line or "24,24-"
  // off the whole line. And the printed line total, after that discount.
  // Both absent on older drafts.
  discount_text?: string | null;
  line_total?: string;
  quantity: string;
  unit: ProductUnit;
  unit_cost: string;
};

// What the parser kept of the invoice's printed totals, in centimes (all
// optional: older drafts lack the newer ones).
export type InvoiceTotals = {
  subtotal_ht?: number | null;
  vat_total?: number | null;
  total_ttc?: number | null;
  stamp_duty?: number | null;
  net_to_pay?: number | null;
  price_basis?: PriceBasis | null;
  vat_percent?: number | null;
  // Discount on the whole invoice (remise globale), as printed.
  global_discount_text?: string | null;
};

export type InvoiceDraft = {
  id: string;
  invoice_number: string | null;
  supplier_id: string | null;
  invoice_date: string | null;
  status: "extracting" | "ready" | "failed";
  photo_paths: string[];
  flags: InvoiceFlag[];
  extraction_started_at: string | null;
  extraction_error: string | null;
  extraction: { supplier_name?: string | null; invoice_number?: string | null } | null;
  totals?: InvoiceTotals | null;
  revision: number;
  source_lines: InvoiceSourceLine[];
  purchase_id: string | null;
  suppliers: { name: string } | null;
};

export type ProductChoice =
  | { kind: "existing"; id: string; name: string; unit: ProductUnit }
  | { kind: "new"; name: string; unit: ProductUnit; sellingPrice: string };

export type InvoiceReviewLine = {
  product: ProductChoice | null;
  quantity: string;
  unitCost: string;
  // Stock units in one billed carton or pack; "" when the line is not billed by pack.
  unitsPer: string;
  // A line with no printed billing unit that is billed by pack all the same:
  // the owner opened "pieces per pack", or the count was read from the name.
  packOpen?: boolean;
  // unitsPer was read from the product name ("45*12"): the owner checks it.
  unitsFromName?: boolean;
  // The owner typed this cost: changing the HT/TTC basis must not overwrite it.
  costTouched?: boolean;
  // The invoice line as the owner confirmed it, per billed unit: quantity,
  // price and discount, starting from what was read. Absent: as read.
  billedQuantity?: string;
  price?: string;
  discount?: string;
};

type ReviewedLine = {
  product_id: string | null;
  new_product: { name: string; selling_price_cents: number } | null;
  unit: ProductUnit;
  quantity: number;
  unit_cost_cents: number;
  units_per_billing_unit: number | null;
  // Audit trail, present when the review knew the printed prices: what the
  // invoice printed (per billed unit), its basis, the basis stored, the rate used.
  printed_unit_cost_cents?: number;
  printed_basis?: PriceBasis | null;
  cost_basis?: PriceBasis;
  vat_percent?: number | null;
  // The discount taken off the printed price to reach the cost, when there was one.
  discount_percent?: number | null;
  discount_cents?: number | null;
  // The invoice-wide discount that was also taken off this cost, when there was one.
  global_discount_percent?: number | null;
  global_discount_cents?: number | null;
  lines_total_cents?: number | null;
};

// The invoice line with the owner's corrections in place of what was read.
export function confirmedSource(
  source: InvoiceSourceLine,
  line: InvoiceReviewLine
): InvoiceSourceLine {
  return {
    ...source,
    billed_quantity: line.billedQuantity ?? source.billed_quantity,
    billed_unit_cost: line.price ?? source.billed_unit_cost,
    discount_text:
      line.discount !== undefined ? line.discount.trim() || null : source.discount_text,
  };
}

// What one invoice line comes to on its printed basis, in centimes: quantity
// times price, less its discount. Null when the quantity or price cannot be
// read, or the discount is unreadable or larger than the line.
export function lineAmounts(
  source: InvoiceSourceLine
): { gross: number; discount: number; net: number } | null {
  const quantity = invoiceQuantity(source.billed_quantity ?? "");
  const price = invoiceMoneyCents(source.billed_unit_cost ?? "");
  if (quantity === null || price === null) return null;
  const gross = lineTotalCents(quantity, price);
  if (!source.discount_text) return { gross, discount: 0, net: gross };
  const printed = invoiceDiscount(source.discount_text);
  if (!printed) return null;
  const discount =
    printed.percent !== null
      ? Math.round((gross * Math.round(printed.percent * 100)) / 10000)
      : printed.cents;
  return discount <= gross ? { gross, discount, net: gross - discount } : null;
}

// The discount to take off the printed price, or null. A percentage needs no
// quantity; an amount is per whole line and needs the billed quantity.
export function sourceDiscount(source: InvoiceSourceLine): LineDiscount | null {
  const printed = invoiceDiscount(source.discount_text);
  if (!printed || !lineAmounts(source)) return null;
  if (printed.percent !== null)
    return { kind: "percent", hundredths: Math.round(printed.percent * 100) };
  const quantity = invoiceQuantity(source.billed_quantity ?? "");
  return quantity === null
    ? null
    : { kind: "amount", cents: printed.cents, quantityMilli: Math.round(quantity * 1000) };
}

// A discount is printed on the line but cannot be used (unreadable, or larger
// than the line): the owner corrects it.
export function discountUnread(source: InvoiceSourceLine): boolean {
  return !!source.discount_text && !sourceDiscount(source);
}

// The printed line total against quantity × price − discount: null when there
// is nothing to compare, else whether they agree within 1 DH.
export function lineTotalAgrees(source: InvoiceSourceLine): boolean | null {
  const printed = invoiceMoneyCents(source.line_total ?? "");
  const amounts = lineAmounts(source);
  if (printed === null || !amounts) return null;
  return Math.abs(amounts.net - printed) <= 100;
}

// A line billed by carton or pack: the owner says how many stock units one
// billed unit holds, and quantity and cost follow. Weight lines are not packs.
export function isPackLine(source: InvoiceSourceLine): boolean {
  return needsUnitConversion(source.billing_unit) && !isWeightBillingUnit(source.billing_unit);
}

// What the printed prices are (HT or TTC, null when unknown) and which cost the
// owner wants stored. Without a basis nothing is converted for TVA.
export type CostBasis = {
  printed: PriceBasis | null;
  store: PriceBasis;
  // Taken off every line's cost, when the invoice prints one.
  global?: GlobalDiscount | null;
};

// A new review defaults to TTC: what the shop really pays per unit.
export function initialCostBasis(draft: Pick<InvoiceDraft, "totals">): CostBasis {
  return { printed: draft.totals?.price_basis ?? null, store: "ttc", global: null };
}

export type LineCost = {
  cents: number | null;
  // Why no cost was filled in, for the owner to see.
  reason: "basis_unknown" | "vat_missing" | "discount_unread" | null;
  vat: number | null;
  converted: boolean;
};

// The unit cost per STOCK unit for one line, from the price printed per billed
// unit: TVA added or removed with the line's rate, then divided over the pieces
// in a carton, in one rounding step.
export function lineCost(source: InvoiceSourceLine, units: number, basis?: CostBasis): LineCost {
  const billed = invoiceMoneyCents(source.billed_unit_cost ?? "");
  const discount = sourceDiscount(source);
  const none = { cents: null, reason: null, vat: null, converted: false } as const;
  if (billed === null) return none;
  // Never a cost without a discount the invoice printed: the owner corrects it first.
  if (source.discount_text && !discount) return { ...none, reason: "discount_unread" };
  if (!basis)
    return {
      ...none,
      cents: convertUnitCostCents({
        billedCents: billed,
        unitsPer: units,
        from: "ht",
        to: "ht",
        vatPercent: null,
        discount,
      }),
    };
  if (!basis.printed) return { ...none, reason: "basis_unknown" };
  const vat = source.vat_percent ?? null;
  const converted = basis.printed !== basis.store;
  if (converted && vat === null) return { ...none, reason: "vat_missing" };
  return {
    cents: convertUnitCostCents({
      billedCents: billed,
      unitsPer: units,
      from: basis.printed,
      to: basis.store,
      vatPercent: vat,
      discount,
      globalDiscount: basis.global ?? null,
    }),
    reason: null,
    vat,
    converted,
  };
}

// How many stock units one billed unit is, when the app can know it: pieces
// count themselves, a carton needs the owner's count, a weight needs a kg product.
export function billedUnits(source: InvoiceSourceLine, line: InvoiceReviewLine): number | null {
  if (isWeightBillingUnit(source.billing_unit)) return line.product?.unit === "kg" ? 1 : null;
  if (isPackLine(source)) return parseUnitsPerBillingUnit(line.unitsPer);
  // No printed billing unit: a piece, unless the owner says it is a pack.
  return line.unitsPer.trim() ? parseUnitsPerBillingUnit(line.unitsPer) : 1;
}

// Whether "pieces per pack" can apply: not to weights, and not when the
// product is itself stocked by the pack.
export function canHavePackSize(source: InvoiceSourceLine, line: InvoiceReviewLine): boolean {
  if (isWeightBillingUnit(source.billing_unit)) return false;
  return isPackLine(source) || line.product?.unit !== "pack";
}

// The field shows on a printed pack line, or once the owner opened it, or
// when a count was found in the name.
export function showsPackSize(source: InvoiceSourceLine, line: InvoiceReviewLine): boolean {
  return (
    canHavePackSize(source, line) &&
    (isPackLine(source) || !!line.packOpen || line.unitsPer.trim() !== "")
  );
}

// Fill quantity and unit cost from the printed values. Anything the app cannot
// work out is left for the owner to type, never guessed. A draft read before
// printed values were kept has nothing to convert and is left as it was.
function autoFill(
  source: InvoiceSourceLine,
  line: InvoiceReviewLine,
  basis: CostBasis | undefined,
  costOnly = false
): InvoiceReviewLine {
  const units = billedUnits(source, line);
  if (units === null || source.billed_unit_cost === undefined) return line;
  const printed = confirmedSource(source, line);
  const cost = lineCost(printed, units, basis);
  const unitCost = cost.cents !== null ? centsToDisplay(cost.cents) : "";
  if (costOnly) return { ...line, unitCost };
  const billedQuantity = invoiceQuantity(printed.billed_quantity ?? "");
  const quantity =
    billedQuantity === null
      ? line.quantity
      : String((Math.round(billedQuantity * 1000) * units) / 1000);
  return { ...line, quantity, unitCost };
}

// Typing "pieces per carton" fills quantity and unit cost from the printed
// values. Anything unreadable leaves them for the owner to type.
export function withUnitsPer(
  source: InvoiceSourceLine,
  line: InvoiceReviewLine,
  text: string,
  basis?: CostBasis
): InvoiceReviewLine {
  return autoFill(
    source,
    { ...line, unitsPer: text, costTouched: false, unitsFromName: false },
    basis
  );
}

// The owner corrected the invoice line (billed quantity, price or discount):
// stock quantity and cost follow, as when it was first read.
export function withPrinted(
  source: InvoiceSourceLine,
  line: InvoiceReviewLine,
  changes: Pick<InvoiceReviewLine, "billedQuantity" | "price" | "discount">,
  basis?: CostBasis
): InvoiceReviewLine {
  return autoFill(source, { ...line, ...changes, costTouched: false }, basis);
}

// A review line as first shown. A pack line whose printed unit names its count
// ("carton de 12") starts converted with that count; the owner can change it.
export function initialReviewLine(source: InvoiceSourceLine, basis?: CostBasis): InvoiceReviewLine {
  const line: InvoiceReviewLine = {
    product: null,
    quantity: source.quantity,
    unitCost: source.unit_cost,
    unitsPer: "",
    // The invoice line as read, for the owner to confirm or correct.
    ...(source.billed_unit_cost !== undefined
      ? {
          billedQuantity: source.billed_quantity ?? "",
          price: source.billed_unit_cost,
          discount: source.discount_text ?? "",
        }
      : {}),
  };
  if (isPackLine(source)) {
    const printed = unitsFromBillingUnit(source.billing_unit);
    return printed
      ? withUnitsPer(source, line, String(printed), basis)
      : autoFill(source, line, basis);
  }
  // No printed billing unit, but the name says "45*12": start as a pack of 12,
  // flagged for the owner to check. Older drafts without printed values keep
  // their lines as read.
  const fromName =
    !isWeightBillingUnit(source.billing_unit) && source.billed_unit_cost !== undefined
      ? unitsFromDescription(source.description)
      : null;
  return fromName
    ? {
        ...withUnitsPer(source, line, String(fromName), basis),
        packOpen: true,
        unitsFromName: true,
      }
    : autoFill(source, line, basis);
}

// Choosing a product. A kilogram product on a line billed by weight takes the
// printed weight and price per kg; any other change of stock unit clears the
// numbers, which were typed for the old unit.
export function withProduct(
  source: InvoiceSourceLine,
  line: InvoiceReviewLine,
  product: ProductChoice | null,
  basis?: CostBasis
): InvoiceReviewLine {
  const previousUnit = line.product?.unit ?? source.unit;
  if (product?.unit === "kg" && isWeightBillingUnit(source.billing_unit))
    return autoFill(source, { ...line, product, unitsPer: "", costTouched: false }, basis);
  // A product stocked by the pack, on a line with no printed billing unit: the
  // billed pack is the stock unit, whatever its name says it holds.
  if (product?.unit === "pack" && !isPackLine(source) && !isWeightBillingUnit(source.billing_unit))
    return autoFill(
      source,
      { ...line, product, unitsPer: "", packOpen: false, unitsFromName: false, costTouched: false },
      basis
    );
  if ((product?.unit ?? source.unit) === previousUnit) return { ...line, product };
  return { ...line, product, quantity: "", unitCost: "", unitsPer: "", costTouched: false };
}

// The owner's earlier choice for this supplier and wording, pre-filled with its
// pack size. Lines the owner already set are left alone.
export function withRememberedMatch(
  source: InvoiceSourceLine,
  line: InvoiceReviewLine,
  match: InvoiceLineMatch | undefined,
  basis?: CostBasis
): InvoiceReviewLine {
  if (!match?.exact || line.product) return line;
  const next = withProduct(
    source,
    line,
    { kind: "existing", id: match.product_id, name: match.product_name, unit: match.product_unit },
    basis
  );
  // The owner confirmed this count for this exact wording and printed unit: it
  // wins over any guess, from the printed unit or from the name.
  const remembered = match.units_per_billing_unit;
  if (!remembered || !canHavePackSize(source, next)) return next;
  if (isPackLine(source)) return withUnitsPer(source, next, String(remembered), basis);
  // No printed unit: last time it was a pack of N, or a single piece (1).
  return remembered > 1
    ? { ...withUnitsPer(source, next, String(remembered), basis), packOpen: true }
    : { ...withUnitsPer(source, next, "", basis), packOpen: false };
}

// The owner changed the printed or stored basis: every cost they did not type
// themselves is worked out again. Quantities and typed costs stay.
export function recostLines(
  sources: InvoiceSourceLine[],
  lines: InvoiceReviewLine[],
  basis: CostBasis
): InvoiceReviewLine[] {
  return lines.map((line, index) =>
    line.costTouched ? line : autoFill(sources[index], line, basis, true)
  );
}

function invoiceMoney(text: string): number | null {
  const cents = invoiceMoneyCents(text);
  return cents !== null && cents <= 100_000_000 ? cents : null;
}

export function buildReviewedInvoiceLine(
  line: InvoiceReviewLine,
  audit?: { source: InvoiceSourceLine; basis: CostBasis }
): ReviewedLine | null {
  const product = line.product;
  if (!product) return null;

  const quantity = invoiceQuantity(line.quantity);
  const cost = invoiceMoney(line.unitCost);
  if (quantity === null || (product.unit !== "kg" && !Number.isInteger(quantity)) || cost === null)
    return null;
  const unitsPer = line.unitsPer.trim() ? parseUnitsPerBillingUnit(line.unitsPer) : null;
  if (line.unitsPer.trim() && unitsPer === null) return null;

  let newProduct: ReviewedLine["new_product"] = null;
  if (product.kind === "new") {
    const name = product.name.trim();
    const price = invoiceMoney(product.sellingPrice);
    if (!name || name.length > 150 || price === null) return null;
    newProduct = { name, selling_price_cents: price };
  }

  // The audit records the invoice line as the owner confirmed it.
  const printed = audit ? confirmedSource(audit.source, line) : null;
  const printedCost = printed ? invoiceMoneyCents(printed.billed_unit_cost ?? "") : null;
  const discount = printed ? sourceDiscount(printed) : null;
  const global = audit?.basis.global ?? null;
  return {
    product_id: product.kind === "existing" ? product.id : null,
    new_product: newProduct,
    unit: product.unit,
    quantity,
    unit_cost_cents: cost,
    units_per_billing_unit: unitsPer,
    ...(audit && printed && printedCost !== null
      ? {
          printed_unit_cost_cents: printedCost,
          printed_basis: audit.basis.printed,
          cost_basis: audit.basis.store,
          vat_percent: printed.vat_percent ?? null,
          ...(discount
            ? {
                discount_percent: discount.kind === "percent" ? discount.hundredths / 100 : null,
                discount_cents: discount.kind === "amount" ? discount.cents : null,
              }
            : {}),
          ...(global
            ? {
                global_discount_percent: global.kind === "percent" ? global.hundredths / 100 : null,
                global_discount_cents: global.kind === "amount" ? global.cents : null,
                lines_total_cents: global.kind === "amount" ? global.linesTotalCents : null,
              }
            : {}),
        }
      : {}),
  };
}

// What is still missing before a line can be approved, in the order the owner
// fills it in. Empty exactly when buildReviewedInvoiceLine accepts the line.
export type LineIssue =
  "product" | "productName" | "sellingPrice" | "unitsPer" | "quantity" | "wholeQuantity" | "cost";

export function reviewLineIssues(source: InvoiceSourceLine, line: InvoiceReviewLine): LineIssue[] {
  const issues: LineIssue[] = [];
  const product = line.product;
  if (!product) issues.push("product");
  if (product?.kind === "new") {
    const name = product.name.trim();
    if (!name || name.length > 150) issues.push("productName");
    if (invoiceMoney(product.sellingPrice) === null) issues.push("sellingPrice");
  }
  const unitsTyped = line.unitsPer.trim() !== "";
  // A printed carton needs its count before quantity and cost can be worked out.
  if (
    (unitsTyped && parseUnitsPerBillingUnit(line.unitsPer) === null) ||
    (!unitsTyped && isPackLine(source) && !line.quantity.trim())
  )
    issues.push("unitsPer");
  const quantity = invoiceQuantity(line.quantity);
  if (quantity === null) {
    if (!issues.includes("unitsPer")) issues.push("quantity");
  } else if ((product?.unit ?? source.unit) !== "kg" && !Number.isInteger(quantity))
    issues.push("wholeQuantity");
  if (invoiceMoney(line.unitCost) === null && !issues.includes("unitsPer")) issues.push("cost");
  return issues;
}

const invoiceFields =
  "id, invoice_number, revision, purchase_id, supplier_id, invoice_date, status, flags, suppliers(name)";
export type InvoiceSummary = Pick<
  InvoiceDraft,
  | "id"
  | "purchase_id"
  | "supplier_id"
  | "invoice_number"
  | "invoice_date"
  | "status"
  | "flags"
  | "suppliers"
>;

export async function listInvoiceDrafts(offset = 0): Promise<InvoiceSummary[]> {
  const { data, error } = await supabase
    .from("invoice_drafts")
    .select(invoiceFields)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(offset, offset + 24);
  if (error) throw error;
  return data as unknown as InvoiceSummary[];
}

export async function createInvoiceDraft(): Promise<string> {
  const { data, error } = await supabase.rpc("create_invoice_draft");
  if (error) throw error;
  return data as string;
}

export async function uploadInvoicePage(id: string, page: number, jpeg: ArrayBuffer) {
  const bucket = supabase.storage.from("invoices");
  const name = `${page}.jpg`;
  const { error } = await bucket.upload(`${id}/${name}`, jpeg, {
    contentType: "image/jpeg",
    upsert: false,
  });
  if (!error) return;
  // A lost response can leave this immutable page uploaded already.
  const { data } = await bucket.list(id, { search: name });
  if (!data?.some((file) => file.name === name)) throw error;
}

export async function extractInvoice(id: string) {
  const { error } = await supabase.functions.invoke("extract-invoice", { body: { draft_id: id } });
  if (error) {
    const status = error.context?.status;
    throw new InvoiceApprovalError("Extraction unavailable", status === 429 ? "429" : null);
  }
}

export async function updateInvoiceHeader(
  draft: InvoiceDraft,
  supplier: string | null,
  number: string,
  date: string
) {
  const { data, error } = await supabase.rpc("update_invoice_draft_header", {
    p_draft_id: draft.id,
    p_revision: draft.revision,
    p_supplier_id: supplier,
    p_invoice_number: number.trim() || null,
    p_invoice_date: date.trim() || null,
  });
  if (error) throw new InvoiceApprovalError(error.message, error.code);
  return data as number;
}

// Product suggestions for each line (migration 034). An exact match is the
// owner's own earlier choice for this supplier and wording, with its pack size.
export type InvoiceLineMatch = {
  line_index: number;
  product_id: string;
  product_name: string;
  product_unit: ProductUnit;
  units_per_billing_unit: number | null;
  exact: boolean;
  score: number;
};

export async function matchInvoiceLines(id: string): Promise<InvoiceLineMatch[]> {
  const { data, error } = await supabase.rpc("match_invoice_lines", { p_draft_id: id });
  if (error) throw error;
  return (data ?? []) as InvoiceLineMatch[];
}

// Pages are recorded on the draft only when extraction starts; until then
// (or when it could not start) read them from the draft's folder.
async function uploadedPages(id: string): Promise<string[]> {
  const { data, error } = await supabase.storage.from("invoices").list(id);
  if (error || !data) return [];
  return data
    .map((file) => file.name)
    .filter((name) => /^[123]\.jpg$/.test(name))
    .sort()
    .map((name) => `${id}/${name}`);
}

export async function invoicePhotoUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from("invoices").createSignedUrl(path, 120);
  if (error) throw error;
  return data.signedUrl;
}

export async function findPurchaseInvoice(id: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("invoice_drafts")
    .select("id, photo_paths")
    .eq("purchase_id", id)
    .maybeSingle();
  if (error) throw error;
  return data?.photo_paths.length ? data.id : null;
}

export async function fetchInvoiceDraft(id: string): Promise<InvoiceDraft> {
  const { data, error } = await supabase
    .from("invoice_drafts")
    .select(
      invoiceFields +
        ", source_lines, extraction, totals, photo_paths, extraction_started_at, extraction_error"
    )
    .eq("id", id)
    .single<InvoiceDraft>();
  if (error) throw new Error(error.message);
  if (!data.photo_paths.length && data.status !== "ready")
    return { ...data, photo_paths: await uploadedPages(id) };
  return data;
}

// Carries the server's SQLSTATE so the screen can say what went wrong (see
// migration 031 for the codes). No code means the request may not have arrived.
export class InvoiceApprovalError extends Error {
  constructor(
    message: string,
    readonly code: string | null
  ) {
    super(message);
    this.name = "InvoiceApprovalError";
  }
}

export async function approveInvoiceDraft(
  draft: InvoiceDraft,
  lines: ReviewedLine[]
): Promise<string> {
  const { data, error } = await supabase.rpc("approve_invoice_draft", {
    p_draft_id: draft.id,
    p_revision: draft.revision,
    p_review_lines: lines,
  });
  if (error) throw new InvoiceApprovalError(error.message, error.code || null);
  return data as string;
}

// The server's refusals, in the owner's language. Anything else (including no
// answer at all) is the generic "could not confirm, try again".
export function approvalErrorKey(code: string | null, revisionChanged: boolean): string {
  if (code === "CM409" || revisionChanged) return "invoices.changed";
  if (code === "CM412") return "invoices.productChanged";
  if (code === "CM413") return "invoices.approvedDifferently";
  if (code === "CM414") return "invoices.futureDate";
  if (code === "22023") return "invoices.invalidLines";
  return "invoices.approveError";
}
