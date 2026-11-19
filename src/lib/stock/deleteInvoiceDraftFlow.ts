import { confirmDestructive } from "@/src/lib/confirmDestructive";
import { deleteErrorKey, deleteInvoiceDraft, InvoiceApprovalError } from "@/src/lib/stock/invoices";
import { isolateBidi } from "@/src/lib/text/bidi";

type Translate = (key: string, options?: Record<string, string>) => string;

export type DeleteDraftOutcome =
  { result: "deleted" } | { result: "cancelled" } | { result: "error"; key: string };

// Ask first (naming the invoice number and supplier when known), then delete.
export async function confirmAndDeleteInvoiceDraft(
  draft: { id: string; invoice_number: string | null; suppliers: { name: string } | null },
  t: Translate
): Promise<DeleteDraftOutcome> {
  const name = isolateBidi(draft.invoice_number ?? t("invoices.untitled"));
  const supplier = draft.suppliers?.name;
  const confirmed = await confirmDestructive(
    t("invoices.deleteTitle"),
    t(supplier ? "invoices.deleteMessageSupplier" : "invoices.deleteMessage", {
      number: name,
      supplier: supplier ? isolateBidi(supplier) : "",
    }),
    t("invoices.deleteConfirm"),
    t("common.cancel")
  );
  if (!confirmed) return { result: "cancelled" };
  try {
    await deleteInvoiceDraft(draft.id);
    return { result: "deleted" };
  } catch (failure) {
    return {
      result: "error",
      key: deleteErrorKey(failure instanceof InvoiceApprovalError ? failure.code : null),
    };
  }
}
