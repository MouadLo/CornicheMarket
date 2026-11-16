// The invoice as a whole: what its lines add up to, its discount on the whole
// invoice (remise globale), and whether that agrees with the totals it prints.
// Every printed total stays editable: the owner confirms or corrects what was
// read before approving. All amounts are integer centimes.

import {
  discountOff,
  invoiceDiscount,
  invoiceMoneyCents,
  matchedTotal,
  totalTargets,
  type LineDiscountPrinted,
  type PriceBasis,
  type PrintedTotals,
} from "@/supabase/functions/_shared/invoiceParse";
import { centsToDisplay } from "@/src/lib/money";
import {
  confirmedSource,
  initialCostBasis,
  initialReviewLine,
  lineAmounts,
  recostLines,
  type CostBasis,
  type InvoiceDraft,
  type InvoiceReviewLine,
  type InvoiceSourceLine,
  type InvoiceTotals,
} from "@/src/lib/stock/invoices";
import type { GlobalDiscount } from "@/src/lib/stock/vat";

// The totals as the owner sees and edits them (text as typed).
export type TotalsInput = {
  globalDiscount: string;
  // Take the discount on the whole invoice off every line's cost.
  applyGlobal: boolean;
  subtotalHt: string;
  vatTotal: string;
  totalTtc: string;
  stampDuty: string;
  netToPay: string;
};

const text = (cents: number | null | undefined) =>
  cents === null || cents === undefined ? "" : centsToDisplay(cents);

// What was read, before the owner decides whether the discount applies.
export function totalsInputFrom(totals: InvoiceTotals | null | undefined): TotalsInput {
  return {
    globalDiscount: totals?.global_discount_text ?? "",
    applyGlobal: false,
    subtotalHt: text(totals?.subtotal_ht),
    vatTotal: text(totals?.vat_total),
    totalTtc: text(totals?.total_ttc),
    stampDuty: text(totals?.stamp_duty),
    netToPay: text(totals?.net_to_pay),
  };
}

export type TotalsCheck =
  // Nothing printed to check the lines against.
  | { status: "unchecked" }
  | { status: "match" | "differs"; basis: PriceBasis; printed: number; diff: number };

export type InvoiceSummary = {
  // Sums of the lines on their printed basis; null when any line cannot be read.
  gross: number | null;
  lineDiscounts: number | null;
  net: number | null;
  // The discount on the whole invoice as read from what the owner sees, and
  // what it takes off the lines (null: unreadable, or larger than the lines).
  global: LineDiscountPrinted | null;
  globalOff: number | null;
  globalUnread: boolean;
  // The lines after the discount, when it applies; else the lines.
  linesTotal: number | null;
  // The lines already match the printed total without the discount: it seems
  // to be inside the prices already, so taking it off again would be wrong.
  globalIncluded: boolean;
  check: TotalsCheck;
  // HT + TVA does not give the printed TTC; TTC + timbre does not give net to pay.
  vatOff: boolean;
  netOff: boolean;
};

function printedFrom(input: TotalsInput): Required<PrintedTotals> {
  const read = (value: string) => (value.trim() ? invoiceMoneyCents(value) : null);
  return {
    subtotal_ht: read(input.subtotalHt),
    vat_total: read(input.vatTotal),
    total_ttc: read(input.totalTtc),
    stamp_duty: read(input.stampDuty),
    net_to_pay: read(input.netToPay),
  };
}

const near = (a: number, b: number) => Math.abs(a - b) <= 100;

// Does a sum of lines match the printed total for the price basis? Unknown
// basis: either total will do.
function matches(sum: number | null, printed: PrintedTotals, basis: PriceBasis | null): boolean {
  const match = matchedTotal(sum, printed);
  return basis === "ht" ? match.ht : basis === "ttc" ? match.ttc : match.ht || match.ttc;
}

export function invoiceSummary(
  sources: InvoiceSourceLine[],
  lines: InvoiceReviewLine[],
  input: TotalsInput,
  basis: PriceBasis | null
): InvoiceSummary {
  const amounts = sources.map((source, index) =>
    lineAmounts(confirmedSource(source, lines[index]))
  );
  const readable = amounts.length > 0 && amounts.every((amount) => amount !== null);
  const sum = (pick: (amount: NonNullable<(typeof amounts)[number]>) => number) =>
    readable ? amounts.reduce((total, amount) => total + pick(amount!), 0) : null;
  const gross = sum((amount) => amount.gross);
  const lineDiscounts = sum((amount) => amount.discount);
  const net = sum((amount) => amount.net);

  const global = invoiceDiscount(input.globalDiscount);
  const globalOff = global && net !== null ? discountOff(net, global) : null;
  // A percentage can apply even when a line cannot be read; an amount cannot.
  const globalUsable = !!global && (global.percent !== null || globalOff !== null);
  const globalUnread = !!input.globalDiscount.trim() && !globalUsable;
  const afterGlobal = net !== null && globalOff !== null ? net - globalOff : null;

  const printed = printedFrom(input);
  const targets = totalTargets(printed);
  const applying = input.applyGlobal && globalUsable;
  const linesTotal = applying ? afterGlobal : net;
  const globalIncluded =
    globalUsable && matches(net, printed, basis) && !matches(afterGlobal, printed, basis);

  // Compare with the total on the lines' basis; unknown basis: TTC if printed, else HT.
  const ttc = targets.ttc[0] ?? null;
  const useTtc =
    basis === "ttc" ||
    (basis === null && (matchedTotal(linesTotal, printed).ttc || targets.ht === null));
  const target = useTtc ? ttc : targets.ht;
  let check: TotalsCheck = { status: "unchecked" };
  if (linesTotal !== null && target !== null) {
    const matched = matches(linesTotal, printed, useTtc ? "ttc" : "ht");
    // Show the total it matched (a TTC can be worked out several ways).
    const shown = matched
      ? ((useTtc ? targets.ttc : [targets.ht!]).find((total) => near(linesTotal, total)) ?? target)
      : target;
    check = {
      status: matched ? "match" : "differs",
      basis: useTtc ? "ttc" : "ht",
      printed: shown,
      diff: linesTotal - shown,
    };
  }

  const { subtotal_ht: ht, vat_total: vat, total_ttc: totalTtc, stamp_duty: stamp } = printed;
  const vatOff =
    ht !== null &&
    vat !== null &&
    totalTtc !== null &&
    !near(ht + vat, totalTtc) &&
    !(stamp !== null && near(ht + vat + stamp, totalTtc));
  const base = totalTtc ?? (ht !== null && vat !== null ? ht + vat : null);
  const netOff =
    printed.net_to_pay !== null &&
    base !== null &&
    !near(base + (stamp ?? 0), printed.net_to_pay) &&
    !near(base, printed.net_to_pay);

  return {
    gross,
    lineDiscounts,
    net,
    global: globalUsable ? global : null,
    globalOff,
    globalUnread,
    linesTotal,
    globalIncluded,
    check,
    vatOff,
    netOff,
  };
}

// Whether the discount on the whole invoice should apply when the review
// opens: yes when the totals confirm it or there is nothing to check against;
// no when the lines already match without it, or nothing matches (the owner
// decides, with the difference in front of them).
export function defaultApplyGlobal(
  sources: InvoiceSourceLine[],
  lines: InvoiceReviewLine[],
  input: TotalsInput,
  basis: PriceBasis | null
): boolean {
  const on = invoiceSummary(sources, lines, { ...input, applyGlobal: true }, basis);
  if (!on.global) return false;
  if (on.check.status === "match") return true;
  if (on.globalIncluded) return false;
  return on.check.status === "unchecked";
}

// The discount every line's cost takes, or null when it does not apply.
export function costGlobalDiscount(
  summary: InvoiceSummary,
  input: TotalsInput
): GlobalDiscount | null {
  const global = summary.global;
  if (!input.applyGlobal || !global) return null;
  if (global.percent !== null)
    return { kind: "percent", hundredths: Math.round(global.percent * 100) };
  return summary.net !== null && summary.net > 0
    ? { kind: "amount", cents: global.cents, linesTotalCents: summary.net }
    : null;
}

export function sameGlobalDiscount(
  a: GlobalDiscount | null | undefined,
  b: GlobalDiscount | null | undefined
) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

// The review as it first opens: lines as read, the totals as read, and the
// discount on the whole invoice applied when the totals confirm it.
export function initialReview(
  draft: Pick<InvoiceDraft, "source_lines" | "totals">,
  printedPrices: boolean
): { lines: InvoiceReviewLine[]; basis: CostBasis; totals: TotalsInput } {
  const start = initialCostBasis(draft);
  const first = draft.source_lines.map((source) =>
    initialReviewLine(source, printedPrices ? start : undefined)
  );
  const read = totalsInputFrom(draft.totals);
  if (!printedPrices) return { lines: first, basis: start, totals: read };
  const totals = {
    ...read,
    applyGlobal: defaultApplyGlobal(draft.source_lines, first, read, start.printed),
  };
  const global = costGlobalDiscount(
    invoiceSummary(draft.source_lines, first, totals, start.printed),
    totals
  );
  if (!global) return { lines: first, basis: start, totals };
  const basis = { ...start, global };
  return { lines: recostLines(draft.source_lines, first, basis), basis, totals };
}
