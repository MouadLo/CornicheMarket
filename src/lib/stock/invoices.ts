import {
  invoiceMoneyCents,
  invoiceQuantity,
  needsUnitConversion,
  type InvoiceFlag,
  type PriceBasis,
} from "@/supabase/functions/_shared/invoiceParse";
import { centsToDisplay } from "@/src/lib/money";
import type { ProductUnit } from "@/src/lib/products/queries";
import {
  isWeightBillingUnit,
  parseUnitsPerBillingUnit,
  unitsFromBillingUnit,
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
  // Line discount (remise) as printed, and as read: a percentage of the line or
  // an amount off the whole line. Absent on older drafts. discount_text without
  // a value could not be read; discount_check means the printed line total does
  // not match price less discount.
  discount_text?: string | null;
  discount_percent?: number | null;
  discount_cents?: number | null;
  discount_check?: boolean;
  quantity: string;
  unit: ProductUnit;
  unit_cost: string;
};

// What the parser kept of the invoice's printed totals (all optional: older drafts).
export type InvoiceTotals = {
  price_basis?: PriceBasis | null;
  vat_percent?: number | null;
  // Discount on the whole invoice (remise globale): as printed, as read, and the
  // lines' sum an amount comes off. check: printed totals do not match it.
  global_discount_text?: string | null;
  global_discount_percent?: number | null;
  global_discount_cents?: number | null;
  lines_total_cents?: number | null;
  global_discount_check?: boolean;
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
  // The owner typed this cost: changing the HT/TTC basis must not overwrite it.
  costTouched?: boolean;
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

// The discount to take off the printed price, or null. A percentage needs no
// quantity; an amount is per whole line and needs the billed quantity.
export function sourceDiscount(source: InvoiceSourceLine): LineDiscount | null {
  if (source.discount_percent)
    return { kind: "percent", hundredths: Math.round(source.discount_percent * 100) };
  if (source.discount_cents) {
    const quantity = invoiceQuantity(source.billed_quantity ?? "");
    if (quantity === null) return null;
    return {
      kind: "amount",
      cents: source.discount_cents,
      quantityMilli: Math.round(quantity * 1000),
    };
  }
  return null;
}

// A discount was printed on the line but the app could not use it: the owner
// must check the cost by hand.
export function discountUnread(source: InvoiceSourceLine): boolean {
  return !!source.discount_text && !sourceDiscount(source);
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

export function totalsGlobalDiscount(
  totals: InvoiceTotals | null | undefined
): GlobalDiscount | null {
  if (totals?.global_discount_percent)
    return { kind: "percent", hundredths: Math.round(totals.global_discount_percent * 100) };
  if (totals?.global_discount_cents && totals.lines_total_cents)
    return {
      kind: "amount",
      cents: totals.global_discount_cents,
      linesTotalCents: totals.lines_total_cents,
    };
  return null;
}

// A discount on the whole invoice was printed but could not be used.
export function globalDiscountUnread(totals: InvoiceTotals | null | undefined): boolean {
  return !!totals?.global_discount_text && !totalsGlobalDiscount(totals);
}

// A new review defaults to TTC: what the shop really pays per unit.
export function initialCostBasis(draft: Pick<InvoiceDraft, "totals">): CostBasis {
  return {
    printed: draft.totals?.price_basis ?? null,
    store: "ttc",
    global: totalsGlobalDiscount(draft.totals),
  };
}

export type LineCost = {
  cents: number | null;
  // Why no cost was filled in, for the owner to see.
  reason: "basis_unknown" | "vat_missing" | null;
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
  return 1;
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
  const cost = lineCost(source, units, basis);
  const unitCost = cost.cents !== null ? centsToDisplay(cost.cents) : "";
  if (costOnly) return { ...line, unitCost };
  const billedQuantity = invoiceQuantity(source.billed_quantity ?? "");
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
  return autoFill(source, { ...line, unitsPer: text, costTouched: false }, basis);
}

// A review line as first shown. A pack line whose printed unit names its count
// ("carton de 12") starts converted with that count; the owner can change it.
export function initialReviewLine(source: InvoiceSourceLine, basis?: CostBasis): InvoiceReviewLine {
  const line = {
    product: null,
    quantity: source.quantity,
    unitCost: source.unit_cost,
    unitsPer: "",
  };
  const printed = isPackLine(source) ? unitsFromBillingUnit(source.billing_unit) : null;
  return printed
    ? withUnitsPer(source, line, String(printed), basis)
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
  // The owner confirmed this count for this exact printed unit: it wins over the guess.
  return isPackLine(source) && match.units_per_billing_unit
    ? withUnitsPer(source, next, String(match.units_per_billing_unit), basis)
    : next;
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

  const printedCost = audit ? invoiceMoneyCents(audit.source.billed_unit_cost ?? "") : null;
  return {
    product_id: product.kind === "existing" ? product.id : null,
    new_product: newProduct,
    unit: product.unit,
    quantity,
    unit_cost_cents: cost,
    units_per_billing_unit: unitsPer,
    ...(audit && printedCost !== null
      ? {
          printed_unit_cost_cents: printedCost,
          printed_basis: audit.basis.printed,
          cost_basis: audit.basis.store,
          vat_percent: audit.source.vat_percent ?? null,
          ...(audit.basis.global
            ? {
                global_discount_percent:
                  audit.basis.global.kind === "percent"
                    ? audit.basis.global.hundredths / 100
                    : null,
                global_discount_cents:
                  audit.basis.global.kind === "amount" ? audit.basis.global.cents : null,
                lines_total_cents:
                  audit.basis.global.kind === "amount" ? audit.basis.global.linesTotalCents : null,
              }
            : {}),
          ...(sourceDiscount(audit.source)
            ? {
                discount_percent: audit.source.discount_percent ?? null,
                discount_cents: audit.source.discount_cents ?? null,
              }
            : {}),
        }
      : {}),
  };
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
