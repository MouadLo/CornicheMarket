import type { VoidPreviewLine } from "@/src/lib/stock/queries";
import { isolateBidi } from "@/src/lib/text/bidi";

// Same pattern as unitLabel.ts: a generic (t: Translate) param instead of
// importing i18next's own TFunction type.
type Translate = (key: string, options?: Record<string, unknown>) => string;

const MAX_LISTED = 8;

// What voiding a delivery is about to do, for the confirm dialog: per
// product the stock and average cost before and after, the rule that past
// sales keep their cost, and a warning if anything goes below zero. Long
// deliveries list the first few and count the rest.
export function voidDeliveryConfirmMessage(
  lines: VoidPreviewLine[],
  t: Translate,
  formatMAD: (cents: number) => string
): string {
  const parts = lines.slice(0, MAX_LISTED).map((line) =>
    t("stockIn.deliveryVoidConfirmLine", {
      product: isolateBidi(line.productName),
      before: line.stockBefore,
      after: line.stockAfter,
      unit: line.unit,
      costBefore: formatMAD(line.costBeforeCents),
      costAfter: formatMAD(line.costAfterCents),
    })
  );

  if (lines.length > MAX_LISTED) {
    parts.push(t("stockIn.deliveryVoidConfirmMore", { count: lines.length - MAX_LISTED }));
  }

  parts.push(t("stockIn.deliveryVoidConfirmNotice"));
  if (lines.some((line) => line.stockAfter < 0)) {
    parts.push(t("stockIn.deliveryVoidConfirmNegative"));
  }

  return parts.join("\n\n");
}
