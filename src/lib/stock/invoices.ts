import {
  invoiceMoneyCents,
  invoiceQuantity,
  needsUnitConversion,
  type InvoiceFlag,
} from "@/supabase/functions/_shared/invoiceParse";
import { centsToDisplay } from "@/src/lib/money";
import type { ProductUnit } from "@/src/lib/products/queries";
import {
  convertPackLine,
  isWeightBillingUnit,
  parseUnitsPerBillingUnit,
  unitsFromBillingUnit,
} from "@/src/lib/stock/packs";
import { supabase } from "@/src/lib/supabase/client";

export type InvoiceSourceLine = {
  description: string;
  billed: string;
  billing_unit?: string | null;
  // As printed per billed unit; absent on drafts read before part 3.
  billed_quantity?: string;
  billed_unit_cost?: string;
  quantity: string;
  unit: ProductUnit;
  unit_cost: string;
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
};

type ReviewedLine = {
  product_id: string | null;
  new_product: { name: string; selling_price_cents: number } | null;
  unit: ProductUnit;
  quantity: number;
  unit_cost_cents: number;
  units_per_billing_unit: number | null;
};

// A line billed by carton or pack: the owner says how many stock units one
// billed unit holds, and quantity and cost follow. Weight lines are not packs.
export function isPackLine(source: InvoiceSourceLine): boolean {
  return needsUnitConversion(source.billing_unit) && !isWeightBillingUnit(source.billing_unit);
}

// Typing "pieces per carton" fills quantity and unit cost from the printed
// values. Anything unreadable leaves them for the owner to type.
export function withUnitsPer(
  source: InvoiceSourceLine,
  line: InvoiceReviewLine,
  text: string
): InvoiceReviewLine {
  const units = parseUnitsPerBillingUnit(text);
  const quantity = invoiceQuantity(source.billed_quantity ?? "");
  const cost = invoiceMoneyCents(source.billed_unit_cost ?? "");
  const converted =
    units !== null && quantity !== null && cost !== null
      ? convertPackLine(quantity, cost, units)
      : null;
  return converted
    ? {
        ...line,
        unitsPer: text,
        quantity: String(converted.quantity),
        unitCost: centsToDisplay(converted.unitCostCents),
      }
    : { ...line, unitsPer: text };
}

// A review line as first shown. A pack line whose printed unit names its count
// ("carton de 12") starts converted with that count; the owner can change it.
export function initialReviewLine(source: InvoiceSourceLine): InvoiceReviewLine {
  const line = {
    product: null,
    quantity: source.quantity,
    unitCost: source.unit_cost,
    unitsPer: "",
  };
  const printed = isPackLine(source) ? unitsFromBillingUnit(source.billing_unit) : null;
  return printed ? withUnitsPer(source, line, String(printed)) : line;
}

// Choosing a product. A kilogram product on a line billed by weight takes the
// printed weight and price per kg; any other change of stock unit clears the
// numbers, which were typed for the old unit.
export function withProduct(
  source: InvoiceSourceLine,
  line: InvoiceReviewLine,
  product: ProductChoice | null
): InvoiceReviewLine {
  const previousUnit = line.product?.unit ?? source.unit;
  if (product?.unit === "kg" && isWeightBillingUnit(source.billing_unit))
    return {
      ...line,
      product,
      quantity: source.billed_quantity ?? "",
      unitCost: source.billed_unit_cost ?? "",
      unitsPer: "",
    };
  if ((product?.unit ?? source.unit) === previousUnit) return { ...line, product };
  return { ...line, product, quantity: "", unitCost: "", unitsPer: "" };
}

// The owner's earlier choice for this supplier and wording, pre-filled with its
// pack size. Lines the owner already set are left alone.
export function withRememberedMatch(
  source: InvoiceSourceLine,
  line: InvoiceReviewLine,
  match: InvoiceLineMatch | undefined
): InvoiceReviewLine {
  if (!match?.exact || line.product) return line;
  const next = withProduct(source, line, {
    kind: "existing",
    id: match.product_id,
    name: match.product_name,
    unit: match.product_unit,
  });
  // The owner confirmed this count for this exact printed unit: it wins over the guess.
  return isPackLine(source) && match.units_per_billing_unit
    ? withUnitsPer(source, next, String(match.units_per_billing_unit))
    : next;
}

function invoiceMoney(text: string): number | null {
  const cents = invoiceMoneyCents(text);
  return cents !== null && cents <= 100_000_000 ? cents : null;
}

export function buildReviewedInvoiceLine(line: InvoiceReviewLine): ReviewedLine | null {
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

  return {
    product_id: product.kind === "existing" ? product.id : null,
    new_product: newProduct,
    unit: product.unit,
    quantity,
    unit_cost_cents: cost,
    units_per_billing_unit: unitsPer,
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
        ", source_lines, extraction, photo_paths, extraction_started_at, extraction_error"
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
