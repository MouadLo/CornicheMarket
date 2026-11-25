// Suggests which app product each web product probably is, so the owner can
// link them in the app. Pure: no Supabase, no files.
import {
  matchCatalog,
  normalizeName,
} from "../../../supabase/functions/_shared/competitorMatch.ts";
import { centsToDisplay } from "../money.ts";

export type WebProductInput = {
  id: string;
  name: string;
  name_fr: string | null;
  size: string | null;
  price_cents: number | null;
};

export type AppProductInput = {
  id: string;
  name: string;
  selling_price_cents: number | null;
  active: boolean;
  kind: string;
};

export type Confidence = "proposed" | "uncertain" | "none";

export type MatchRow = {
  webId: string;
  webName: string;
  size: string | null;
  sheetPrice: string | null; // DH, "6.00"
  appProductId: string | null;
  appName: string | null;
  appPrice: string | null;
  confidence: Confidence;
  priceDiffers: boolean;
};

const dh = (cents: number | null | undefined) =>
  cents === null || cents === undefined ? null : centsToDisplay(cents);

// The text we match on: the French name plus the size, unless the name
// already says it.
export function webMatchName(p: Pick<WebProductInput, "name" | "name_fr" | "size">): string {
  const base = (p.name_fr ?? "").trim() || p.name.trim();
  const size = (p.size ?? "").trim();
  if (!size) return base;
  return normalizeName(base).includes(normalizeName(size)) ? base : `${base} ${size}`;
}

export function buildMatchReport(
  webProducts: WebProductInput[],
  appProducts: AppProductInput[]
): MatchRow[] {
  const candidates = appProducts.filter((p) => p.active && p.kind !== "misc");
  const byApp = new Map(candidates.map((p) => [p.id, p]));
  const results = matchCatalog(
    webProducts.map((w) => ({ id: w.id, name: webMatchName(w) })),
    candidates.map((p) => ({ id: p.id, name: p.name }))
  );
  const byWeb = new Map(results.map((r) => [r.itemId, r]));

  return webProducts.map((w) => {
    const result = byWeb.get(w.id);
    const app = result?.productId ? byApp.get(result.productId) : undefined;
    const confidence: Confidence = !app ? "none" : result?.uncertain ? "uncertain" : "proposed";
    const appCents = app?.selling_price_cents ?? null;
    return {
      webId: w.id,
      webName: (w.name_fr ?? "").trim() || w.name,
      size: (w.size ?? "").trim() || null,
      sheetPrice: dh(w.price_cents),
      appProductId: app?.id ?? null,
      appName: app?.name ?? null,
      appPrice: dh(appCents),
      confidence,
      priceDiffers:
        !!app && w.price_cents !== null && appCents !== null && w.price_cents !== appCents,
    };
  });
}

const HEADER = [
  "ID web",
  "Produit web",
  "Taille",
  "Prix du site (DH)",
  "ID produit app",
  "Produit app suggéré",
  "Prix app (DH)",
  "Confiance",
  "Prix différent",
];

const CONFIDENCE_FR: Record<Confidence, string> = {
  proposed: "proposé",
  uncertain: "incertain",
  none: "aucun",
};

function csvField(value: string | null): string {
  const s = value ?? "";
  return /[",;\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// UTF-8 with a BOM so Excel and Numbers show the accents.
export function matchReportToCsv(rows: MatchRow[]): string {
  const lines = [HEADER.map(csvField).join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.webId,
        r.webName,
        r.size,
        r.sheetPrice,
        r.appProductId,
        r.appName,
        r.appPrice,
        CONFIDENCE_FR[r.confidence],
        r.priceDiffers ? "oui" : "non",
      ]
        .map(csvField)
        .join(",")
    );
  }
  return "﻿" + lines.join("\r\n") + "\r\n";
}

export function summarizeMatchReport(rows: MatchRow[]) {
  return {
    total: rows.length,
    proposed: rows.filter((r) => r.confidence === "proposed").length,
    uncertain: rows.filter((r) => r.confidence === "uncertain").length,
    none: rows.filter((r) => r.confidence === "none").length,
    priceDiffers: rows.filter((r) => r.priceDiffers).length,
  };
}
