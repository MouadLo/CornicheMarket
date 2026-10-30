import type { PaymentMethod } from "@/src/lib/sales/queries";

// Translation key for how a sale was paid. The payment sheet's buttons and
// the sale history both used to print the raw database value ("cash",
// "card") in every language.
export function paymentMethodKey(method: PaymentMethod): string {
  switch (method) {
    case "cash":
      return "sell.paymentCash";
    case "card":
      return "sell.paymentCard";
    case "credit":
      return "sell.historyPayLater";
  }
}
