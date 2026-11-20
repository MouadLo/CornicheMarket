// Words for loyalty amounts. The dirham value always comes first, points second:
// "3.40 DH · 34 points".
import { formatMAD } from "@/src/lib/money";
import { isolateLtr } from "@/src/lib/text/bidi";

type T = (key: string, options?: Record<string, unknown>) => string;

export function pointsText(t: T, points: number): string {
  const n = Math.abs(Math.trunc(points));
  return t(n === 1 ? "loyalty.pointsOne" : "loyalty.pointsMany", { points: isolateLtr(String(n)) });
}

export function valueText(points: number, pointValueCents: number): string {
  return isolateLtr(formatMAD(Math.max(0, Math.trunc(points)) * pointValueCents));
}

// "3.40 DH · 34 points"
export function valueAndPoints(t: T, points: number, pointValueCents: number): string {
  return `${valueText(points, pointValueCents)} · ${pointsText(t, points)}`;
}

// "+34" / "−12", always left to right.
export function signedPoints(points: number): string {
  return isolateLtr(`${points < 0 ? "−" : "+"}${Math.abs(Math.trunc(points))}`);
}

export function ledgerLabelKey(kind: string, note?: string | null): string {
  switch (kind) {
    case "earn":
      return "loyalty.kindEarn";
    case "redeem":
      return "loyalty.kindRedeem";
    case "sale_adjust":
      return "loyalty.kindSaleAdjust";
    default:
      return note === "welcome" ? "loyalty.kindWelcome" : "loyalty.kindAdjust";
  }
}
