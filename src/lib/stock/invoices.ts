import {
  invoiceMoneyCents,
  invoiceQuantity,
  type InvoiceFlag,
} from "@/supabase/functions/_shared/invoiceParse";
import type { ProductUnit } from "@/src/lib/products/queries";
import { supabase } from "@/src/lib/supabase/client";

type InvoiceSourceLine = {
  description: string;
  billed: string;
  billing_unit?: string | null;
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

type ProductChoice =
  | { kind: "existing"; id: string; name: string; unit: ProductUnit }
  | { kind: "new"; name: string; unit: ProductUnit; sellingPrice: string };

export type InvoiceReviewLine = {
  product: ProductChoice | null;
  quantity: string;
  unitCost: string;
};

type ReviewedLine = {
  product_id: string | null;
  new_product: { name: string; selling_price_cents: number } | null;
  unit: ProductUnit;
  quantity: number;
  unit_cost_cents: number;
};

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
  if (code === "22023") return "invoices.invalidLines";
  return "invoices.approveError";
}
