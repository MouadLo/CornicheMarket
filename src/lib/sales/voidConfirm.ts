import { formatMAD } from "@/src/lib/money";

// Same pattern as unitLabel.ts: a generic (t: Translate) param instead of
// importing i18next's own TFunction type.
type Translate = (key: string, options?: Record<string, unknown>) => string;

// What voiding a sale is about to do, stated in money terms, for the
// confirm dialog -- the void button itself used to commit on one tap.
export function voidSaleConfirmMessage(totalCents: number, t: Translate): string {
  return t("sell.voidConfirmMessage", { amount: formatMAD(totalCents) });
}
