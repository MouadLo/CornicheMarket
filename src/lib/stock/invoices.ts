import { parseMoneyToCents } from "@/src/lib/money";
import type { ProductUnit } from "@/src/lib/products/queries";
import { supabase } from "@/src/lib/supabase/client";

type InvoiceSourceLine = {
  description: string;
  billed: string;
  quantity: string;
  unit: ProductUnit;
  unit_cost: string;
};

export type InvoiceDraft = {
  id: string;
  invoice_number: string;
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

function normalizeDecimal(text: string): string {
  return text
    .trim()
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - "٠".charCodeAt(0)))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - "۰".charCodeAt(0)))
    .replace(/[,٫]/g, ".");
}

function invoiceMoney(text: string): number | null {
  const decimal = normalizeDecimal(text);
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(decimal)) return null;
  const cents = parseMoneyToCents(decimal);
  return cents !== null && cents <= 100_000_000 ? cents : null;
}

export function buildReviewedInvoiceLine(line: InvoiceReviewLine): ReviewedLine | null {
  const product = line.product;
  if (!product) return null;

  const decimal = normalizeDecimal(line.quantity);
  const quantityPattern = product.unit === "kg" ? /^\d{1,6}(\.\d{1,3})?$/ : /^\d{1,6}$/;
  const quantity = Number(decimal);
  const cost = invoiceMoney(line.unitCost);
  if (!quantityPattern.test(decimal) || quantity <= 0 || cost === null) return null;

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

export async function fetchInvoiceDraft(id: string): Promise<InvoiceDraft> {
  const { data, error } = await supabase
    .from("invoice_drafts")
    .select("id, invoice_number, revision, source_lines, purchase_id, suppliers(name)")
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
