import { useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { BigButton } from "@/src/components/BigButton";
import { ProductSearchPicker } from "@/src/components/stock/ProductSearchPicker";
import { Banner } from "@/src/components/ui/Banner";
import { Card } from "@/src/components/ui/Card";
import { showToast } from "@/src/lib/dialog/store";
import { formatMAD } from "@/src/lib/money";
import { updateSellingPrice, type Product } from "@/src/lib/products/queries";
import { isolateBidi, keepNumberLtr } from "@/src/lib/text/bidi";
import { linkWebProduct } from "@/src/lib/webstore/queries";
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

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
    } finally {
      setBusy(false);
    }
  };

  const doLink = (candidate: LinkCandidate, changeAppPrice: boolean) =>
    run(async () => {
      setNotice(null);
      if (changeAppPrice && product.price_cents !== null) {
        try {
          // The app's own price path: recorded in the selling price history.
          await updateSellingPrice(candidate.id, product.price_cents);
        } catch {
          showToast({ text: t("webstore.priceChangeError"), tone: "info" });
          return;
        }
      }
      try {
        await linkWebProduct(product.id, candidate.id);
      } catch {
        showToast({
          text: t(changeAppPrice ? "webstore.priceChangedLinkFailed" : "webstore.linkError"),
          tone: "info",
        });
        if (changeAppPrice) await onChanged().catch(() => undefined);
        return;
      }
      setPending(null);
      setChanging(false);
      await onChanged().catch(() => undefined);
    });

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
            disabled={busy}
            onPress={() => void doLink(pending, true)}
          />
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
