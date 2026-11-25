import { isolateBidi } from "@/src/lib/text/bidi";
import type { KitProblem } from "@/src/lib/webstore/kits";
import type { WebProduct } from "@/src/lib/webstore/types";
import { displayName } from "./WebProductRow";

type T = (key: string, options?: Record<string, unknown>) => string;

// A problem of a kit in words: "Kinder Bueno est en rupture", "Produit
// introuvable (p020)"...
export function problemText(
  t: T,
  problem: KitProblem,
  byId: ReadonlyMap<string, WebProduct>
): string {
  if (!("webProductId" in problem)) return t(`webstore.kits.problem.${problem.kind}`);
  const wp = byId.get(problem.webProductId);
  const name = isolateBidi(wp ? displayName(wp) : problem.webProductId);
  return t(`webstore.kits.problem.${problem.kind}`, { name, id: problem.webProductId });
}

// The line under a kit: visible, or hidden and why (the first problem).
export function statusLine(
  t: T,
  status: { shownOnSite: boolean; problems: KitProblem[] },
  byId: ReadonlyMap<string, WebProduct>
): string {
  if (status.shownOnSite) return t("webstore.kits.shown");
  const first = status.problems[0];
  return first
    ? t("webstore.kits.hiddenBecause", { reason: problemText(t, first, byId) })
    : t("webstore.kits.hidden");
}
