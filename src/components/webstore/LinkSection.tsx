import { useEffect, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { BigButton } from "@/src/components/BigButton";
import { ProductSearchPicker } from "@/src/components/stock/ProductSearchPicker";
import { Banner } from "@/src/components/ui/Banner";
import { Card } from "@/src/components/ui/Card";
import { bpToPercentText } from "@/src/lib/competitors/pricing";
import { confirmDestructive } from "@/src/lib/confirmDestructive";
import { showToast } from "@/src/lib/dialog/store";
import { errorKeyOr } from "@/src/lib/errors/userMessage";
import { formatMAD } from "@/src/lib/money";
import { undoPriceChange, type Product } from "@/src/lib/products/queries";
import { isolateBidi, keepNumberLtr } from "@/src/lib/text/bidi";
import { checkSitePriceMargin, type PriceMarginCheck } from "@/src/lib/webstore/priceMargin";
import { applyWebPrice, fetchProductMarginInfo, linkWebProduct } from "@/src/lib/webstore/queries";
import { excludedReason, linkSuggestions, priceConflict } from "@/src/lib/webstore/resolve";
import type { LinkCandidate, WebProduct } from "@/src/lib/webstore/types";
import { Text } from "@/src/theme/Text";
import { colors, radius } from "@/src/theme/tokens";

type Props = {
  product: WebProduct;
  // Every web product (to know which app products are already linked).
  all: readonly WebProduct[];
  candidates: readonly LinkCandidate[];
  // Reloads the screen's data after the link (or the app price) changed.
  onChanged: () => Promise<void>;
};

const price = (cents: number) => keepNumberLtr(formatMAD(cents));

const fromPicked = (p: Product): LinkCandidate => ({
  id: p.id,
  name: p.name,
  selling_price_cents: p.selling_price_cents,
  stock_quantity: p.stock_quantity,
  active: p.active,
  // The picker only lists regular products (fetchProducts hides Divers).
  kind: "regular",
});

// Section 1 of the edit screen: which app product this web product follows.
// Linking is saved at once. When the typed site price differs from the app's,
// the owner chooses which price is right before anything is linked.
export function LinkSection({ product, all, candidates, onChanged }: Props) {
  const { t } = useTranslation();
  const [pending, setPending] = useState<LinkCandidate | null>(null);
  const [changing, setChanging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const linked = product.product_id !== null;
  const takenIds = useMemo(
    () =>
      new Set(
        all.filter((p) => p.id !== product.id && p.product_id).map((p) => p.product_id as string)
      ),
    [all, product.id]
  );
  const suggestions = useMemo(
    () => (linked ? [] : linkSuggestions(product, candidates, 3, takenIds)),
    [linked, product, candidates, takenIds]
  );
  const conflict = pending ? priceConflict(product, pending) : null;

  // The margin the site price would leave, checked while the owner chooses.
  // null = still loading; a failed read is "unknown" (it never blocks).
  const [margin, setMargin] = useState<{ check: PriceMarginCheck; minMarginBp: number } | null>(
    null
  );
  const [costCents, setCostCents] = useState<number | null>(null);
  const pendingId = pending?.id ?? null;
  const siteCents = conflict?.siteCents ?? null;
  useEffect(() => {
    setMargin(null);
    if (pendingId === null || siteCents === null) return;
    let cancelled = false;
    fetchProductMarginInfo(pendingId)
      .catch(() => ({ costCents: null, minMarginBp: 0 }))
      .then((info) => {
        if (cancelled) return;
        setCostCents(info.costCents);
        setMargin({
          check: checkSitePriceMargin({ newPriceCents: siteCents, ...info }),
          minMarginBp: info.minMarginBp,
        });
      });
    return () => {
      cancelled = true;
    };
  }, [pendingId, siteCents]);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
    } finally {
      setBusy(false);
    }
  };

  // "Undo" only puts the app price back: the product stays linked (the owner
  // can unlink). The toasts say so.
  const undoAction = (batchId: string, oldCents: number) => ({
    label: t("webstore.priceUndoLabel"),
    onPress: () => {
      undoPriceChange(batchId)
        .then((result) => {
          showToast({
            text:
              result.restored > 0
                ? t("webstore.priceUndone", { price: price(oldCents) })
                : t("webstore.priceUndoSkipped"),
            tone: result.restored > 0 ? "success" : "info",
          });
          return onChanged();
        })
        .catch((failure) =>
          showToast({ text: t(errorKeyOr(failure, "webstore.priceUndoError")), tone: "info" })
        );
    },
  });

  const doLink = (candidate: LinkCandidate, changeAppPrice: boolean) =>
    run(async () => {
      setNotice(null);
      let batchId: string | null = null;
      if (changeAppPrice && product.price_cents !== null) {
        try {
          // One undoable batch, recorded in the selling price history.
          batchId = (await applyWebPrice(candidate.id, product.price_cents)).batchId;
        } catch {
          showToast({ text: t("webstore.priceChangeError"), tone: "info" });
          return;
        }
      }
      const oldCents = candidate.selling_price_cents;
      try {
        await linkWebProduct(product.id, candidate.id);
      } catch {
        showToast({
          text: t(changeAppPrice ? "webstore.priceChangedLinkFailedUndo" : "webstore.linkError"),
          tone: "info",
          ...(batchId ? { duration: 10000, action: undoAction(batchId, oldCents) } : {}),
        });
        if (changeAppPrice) await onChanged().catch(() => undefined);
        return;
      }
      if (batchId && product.price_cents !== null) {
        showToast({
          text: t("webstore.priceChangedToast", {
            old: price(oldCents),
            new: price(product.price_cents),
          }),
          tone: "success",
          duration: 10000,
          action: undoAction(batchId, oldCents),
        });
      }
      setPending(null);
      setChanging(false);
      await onChanged().catch(() => undefined);
    });

  // A price that leaves a low margin or a loss asks first; the owner may go on.
  const confirmSitePrice = async (candidate: LinkCandidate) => {
    const level = margin?.check.level;
    if (level === "low" || level === "loss") {
      const ok = await confirmDestructive(
        t(level === "loss" ? "webstore.marginLossTitle" : "webstore.marginLowTitle"),
        marginLine(margin as NonNullable<typeof margin>, level),
        t("webstore.marginConfirmLabel"),
        t("common.cancel")
      );
      if (!ok) return;
    }
    await doLink(candidate, true);
  };

  const marginLine = (m: NonNullable<typeof margin>, level: "low" | "loss" | "ok") => {
    if (level === "loss") return t("webstore.marginLoss", { cost: price(costCents ?? 0) });
    if (level === "low") {
      return t("webstore.marginLow", {
        margin: bpToPercentText(Math.max(0, m.check.marginBp ?? 0)),
        min: bpToPercentText(m.minMarginBp),
        minPrice: price(m.check.minPriceCents ?? 0),
      });
    }
    return t("webstore.marginOk", {
      price: price(siteCents ?? 0),
      margin: bpToPercentText(m.check.marginBp ?? 0),
    });
  };

  const requestLink = (candidate: LinkCandidate) => {
    if (candidate.kind === "misc" || !candidate.active) {
      setNotice(t("webstore.linkMisc"));
      return;
    }
    setNotice(null);
    if (priceConflict(product, candidate)) setPending(candidate);
    else void doLink(candidate, false);
  };

  const unlink = () =>
    run(async () => {
      try {
        await linkWebProduct(product.id, null);
      } catch {
        showToast({ text: t("webstore.unlinkError"), tone: "info" });
        return;
      }
      setPending(null);
      setChanging(false);
      await onChanged().catch(() => undefined);
    });

  const reason = excludedReason(product);

  return (
    <Card title={t("webstore.linkTitle")} style={styles.card}>
      {linked ? (
        <View style={styles.block}>
          {product.app ? (
            <>
              <Text style={styles.appName}>{isolateBidi(product.app.name)}</Text>
              <Text style={styles.meta}>
                {t("webstore.linkedAppPrice", { price: price(product.app.selling_price_cents) })}
              </Text>
              <Text style={styles.meta}>
                {t("webstore.linkedAppStock", { qty: product.app.stock_quantity })}
              </Text>
            </>
          ) : null}
          {reason === "missing" ? <Banner tone="warn" text={t("webstore.linkedMissing")} /> : null}
          {reason === "inactive" ? (
            <Banner tone="warn" text={t("webstore.linkedInactive")} />
          ) : null}
          {!pending ? (
            <View style={styles.buttons}>
              <View style={styles.flex}>
                <BigButton
                  label={t("webstore.linkChange")}
                  variant="secondary"
                  disabled={busy}
                  onPress={() => setChanging((open) => !open)}
                />
              </View>
              <View style={styles.flex}>
                <BigButton
                  label={t("webstore.linkRemove")}
                  variant="secondary"
                  disabled={busy}
                  onPress={() => void unlink()}
                />
              </View>
            </View>
          ) : null}
        </View>
      ) : (
        <View style={styles.block}>
          <Text style={styles.meta}>{t("webstore.linkNone")}</Text>
          <Text style={styles.heading}>{t("webstore.suggestions")}</Text>
          {suggestions.length === 0 ? (
            <Text style={styles.meta}>{t("webstore.noSuggestions")}</Text>
          ) : (
            suggestions.map((s) => (
              <View key={s.product.id} style={styles.suggestion}>
                <View style={styles.flex}>
                  <Text style={styles.appName} numberOfLines={2}>
                    {isolateBidi(s.product.name)}
                  </Text>
                  <Text style={styles.meta}>
                    {price(s.product.selling_price_cents)} ·{" "}
                    {t(
                      s.confidence === "proposed"
                        ? "webstore.confProposed"
                        : "webstore.confUncertain"
                    )}
                  </Text>
                </View>
                <BigButton
                  label={t("webstore.linkAction")}
                  disabled={busy}
                  onPress={() => requestLink(s.product)}
                />
              </View>
            ))
          )}
        </View>
      )}

      {!linked || changing ? (
        <View style={styles.block}>
          <Text style={styles.heading}>{t("webstore.searchLabel")}</Text>
          <ProductSearchPicker
            excludeIds={product.product_id ? [product.product_id] : []}
            onPick={(picked) => requestLink(fromPicked(picked))}
          />
        </View>
      ) : null}

      {notice ? <Banner tone="warn" text={notice} /> : null}

      {pending && conflict ? (
        <View style={styles.conflict} testID="webstore-conflict">
          <Text style={styles.conflictTitle}>{t("webstore.conflictTitle")}</Text>
          <Text style={styles.meta}>
            {t("webstore.conflictBody", {
              site: price(conflict.siteCents),
              app: price(conflict.appCents),
            })}
          </Text>
          <Text style={styles.appName}>{isolateBidi(pending.name)}</Text>
          <BigButton
            label={t("webstore.keepAppPrice", { price: price(conflict.appCents) })}
            disabled={busy}
            onPress={() => void doLink(pending, false)}
          />
          <BigButton
            label={t("webstore.siteIsRight", { price: price(conflict.siteCents) })}
            variant="secondary"
            disabled={busy || margin === null}
            onPress={() => void confirmSitePrice(pending)}
          />
          {margin === null ? (
            <Text style={styles.meta}>{t("webstore.marginChecking")}</Text>
          ) : margin.check.level === "unknown" ? (
            <Text style={styles.meta} testID="webstore-margin">
              {t("webstore.marginUnknown")}
            </Text>
          ) : (
            <Banner
              tone={
                margin.check.level === "loss" ? "bad" : margin.check.level === "low" ? "warn" : "ok"
              }
              text={marginLine(margin, margin.check.level)}
            />
          )}
          <BigButton
            label={t("common.cancel")}
            variant="secondary"
            disabled={busy}
            onPress={() => setPending(null)}
          />
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: 12 },
  block: { gap: 8 },
  flex: { flex: 1 },
  buttons: { flexDirection: "row", gap: 8 },
  appName: { fontSize: 16, fontWeight: "600", color: colors.ink900 },
  meta: { fontSize: 14, color: colors.ink600, lineHeight: 20 },
  heading: { fontSize: 14, fontWeight: "700", color: colors.ink700 },
  suggestion: { flexDirection: "row", alignItems: "center", gap: 12 },
  conflict: {
    gap: 8,
    padding: 12,
    borderRadius: radius.control,
    backgroundColor: colors.warning100,
  },
  conflictTitle: { fontSize: 16, fontWeight: "700", color: colors.warning700 },
});
