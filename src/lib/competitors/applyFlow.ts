import type { ProductComparison } from "@/src/lib/competitors/overview";
import { applyCompetitorSuggestions } from "@/src/lib/competitors/queries";
import { showToast } from "@/src/lib/dialog/store";
import { errorKeyOr } from "@/src/lib/errors/userMessage";
import { undoPriceChange } from "@/src/lib/products/queries";

type Translate = (key: string, values?: Record<string, unknown>) => string;

// Applies the suggested price of each product (one batch, so one undo), then
// tells the owner what happened. `reload` runs after a change and after an undo.
export async function applySuggestions(
  items: ProductComparison[],
  t: Translate,
  reload: () => Promise<void>
): Promise<void> {
  const prices = items
    .filter((p) => p.decision.suggestedCents !== null)
    .map((p) => ({ productId: p.productId, priceCents: p.decision.suggestedCents as number }));
  await applyPrices(prices, t, reload);
}

// Same, for prices the caller worked out itself (the Opportunités tab).
export async function applyPrices(
  prices: { productId: string; priceCents: number }[],
  t: Translate,
  reload: () => Promise<void>
): Promise<void> {
  if (prices.length === 0) return;
  try {
    const result = await applyCompetitorSuggestions(prices);
    if (result.changed === 0 || !result.batchId) {
      showToast({ text: t("competitors.appliedNothing"), tone: "info" });
    } else {
      const batchId = result.batchId;
      showToast({
        text:
          result.changed === 1
            ? t("competitors.applied")
            : t("competitors.appliedMany", { count: result.changed }),
        tone: "success",
        duration: 10000,
        action: {
          label: t("competitors.applyUndo"),
          onPress: () => {
            undoPriceChange(batchId)
              .then(() => {
                showToast({ text: t("competitors.undone"), tone: "success" });
                return reload();
              })
              .catch((failure) =>
                showToast({ text: t(errorKeyOr(failure, "competitors.applyError")), tone: "info" })
              );
          },
        },
      });
    }
    await reload();
  } catch (failure) {
    showToast({ text: t(errorKeyOr(failure, "competitors.applyError")), tone: "info" });
  }
}
