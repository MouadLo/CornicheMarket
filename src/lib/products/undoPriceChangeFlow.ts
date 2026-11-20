import { confirmDestructive } from "@/src/lib/confirmDestructive";
import { showToast } from "@/src/lib/dialog/store";
import { errorKeyOr } from "@/src/lib/errors/userMessage";
import { undoPriceChange, type UndoPriceChangeResult } from "@/src/lib/products/queries";
import { isolateLtr } from "@/src/lib/text/bidi";

type Translate = (key: string, values?: Record<string, unknown>) => string;

export function formatPercent(percent: number): string {
  return `${percent > 0 ? "+" : ""}${percent}%`;
}

// Ask first (stating how many products go back), then undo, then say how many
// prices were restored and how many were left alone because they were edited
// since. Resolves null when the owner said no or the undo failed (a toast says
// why), so callers refresh their list only on a result.
export async function undoPriceChangeWithConfirm(
  batch: { id: string; percent: number; product_count: number },
  t: Translate
): Promise<UndoPriceChangeResult | null> {
  const ok = await confirmDestructive(
    t("products.priceUndoConfirmTitle"),
    t("products.priceUndoConfirmMessage", {
      count: batch.product_count,
      percent: isolateLtr(formatPercent(batch.percent)),
    }),
    t("products.priceUndoConfirmLabel"),
    // Not "Annuler": in French that is also the word for undoing the change.
    t("products.priceUndoKeep")
  );
  if (!ok) return null;
  try {
    const result = await undoPriceChange(batch.id);
    showToast({
      text:
        result.skipped > 0
          ? t("products.priceUndoDoneSkipped", result)
          : t("products.priceUndoDone", result),
      tone: "success",
    });
    return result;
  } catch (failure) {
    showToast({ text: t(errorKeyOr(failure, "products.priceUndoError")), tone: "info" });
    return null;
  }
}
