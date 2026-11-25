import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { BigButton } from "@/src/components/BigButton";
import { LoadError } from "@/src/components/ui/LoadError";
import { applyPrices } from "@/src/lib/competitors/applyFlow";
import {
  moneyOnTheTable,
  priceCheckAlerts,
  suggestPriceCheck,
} from "@/src/lib/competitors/opportunities";
import { compareProducts, type ProductComparison } from "@/src/lib/competitors/overview";
import { bpToDisplay } from "@/src/lib/competitors/pricing";
import { fetchCompetitorRows, setPriceCheck } from "@/src/lib/competitors/queries";
import { confirm, showToast } from "@/src/lib/dialog/store";
import { errorKey, errorKeyOr } from "@/src/lib/errors/userMessage";
import { formatMAD } from "@/src/lib/money";
import { isolateLtr } from "@/src/lib/text/bidi";
import { Text } from "@/src/theme/Text";
import { colors, radius } from "@/src/theme/tokens";

const dh = (cents: number) => isolateLtr(formatMAD(cents));
// Units sold: whole for pieces, up to two decimals for products sold by weight.
const qty = (value: number) => isolateLtr(String(Math.round(value * 100) / 100));

const openProduct = (id: string) => router.push(`/(app)/competitors/${id}`);

// The "Opportunités" tab (owner only): price-check products that are dearer than
// a competitor, the money we leave on the table where we are cheaper, and the
// best sellers worth tagging as price-check products.
export function OpportunitiesTab() {
  const { t } = useTranslation();
  const [products, setProducts] = useState<ProductComparison[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setProducts(compareProducts(await fetchCompetitorRows(), Date.now()));
    } catch (failure) {
      setLoadError(errorKey(failure));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const alerts = useMemo(() => priceCheckAlerts(products ?? []), [products]);
  const money = useMemo(() => moneyOnTheTable(products ?? []), [products]);
  const suggestions = useMemo(() => suggestPriceCheck(products ?? []), [products]);

  // Confirm old -> new, then the same apply flow as the Suivis tab (one batch, undo).
  const changePrice = async (item: ProductComparison, newCents: number) => {
    if (busy) return;
    setBusy(true);
    try {
      const ok = await confirm({
        title: t("competitors.opp.confirmTitle"),
        summary: item.name,
        consequences: [
          {
            label: t("competitors.opp.priceBefore"),
            before: dh(item.sellingPriceCents),
            after: dh(newCents),
          },
        ],
        confirmLabel: t("competitors.opp.confirmLabel"),
      });
      if (!ok) return;
      await applyPrices([{ productId: item.productId, priceCents: newCents }], t, load);
    } finally {
      setBusy(false);
    }
  };

  const tag = async (item: ProductComparison) => {
    if (busy) return;
    setBusy(true);
    try {
      await setPriceCheck(item.productId, true);
      await load();
    } catch (failure) {
      showToast({ text: t(errorKeyOr(failure, "competitors.priceCheckError")), tone: "info" });
    } finally {
      setBusy(false);
    }
  };

  if (loadError) {
    return (
      <LoadError
        title={t("competitors.loadErrorScreen")}
        reasonKey={loadError}
        onRetry={() => void load()}
      />
    );
  }
  if (!products) return <ActivityIndicator style={{ marginTop: 40 }} />;

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Section title={t("competitors.opp.alertsTitle")}>
        {alerts.length === 0 ? (
          <Text style={styles.hint}>{t("competitors.opp.alertsEmpty")}</Text>
        ) : (
          alerts.map((alert) => {
            const item = alert.comparison;
            const offer = item.decision.offer;
            return (
              <View key={item.productId} style={styles.card}>
                <Pressable accessibilityRole="link" onPress={() => openProduct(item.productId)}>
                  <Text style={styles.name}>{item.name}</Text>
                </Pressable>
                <Text style={styles.line}>
                  {t("competitors.opp.alertRow", {
                    ours: dh(item.sellingPriceCents),
                    shop: offer?.shopName ?? "",
                    theirs: dh(offer?.priceCents ?? 0),
                  })}
                </Text>
                <Text style={styles.bad}>
                  {t("competitors.opp.gap", {
                    gap: dh(alert.gapCents),
                    percent: isolateLtr(`${bpToDisplay(alert.gapBp)} %`),
                  })}
                </Text>
                {alert.action === "apply" && alert.suggestedCents !== null ? (
                  <BigButton
                    label={t("competitors.opp.setPrice", { price: dh(alert.suggestedCents) })}
                    disabled={busy}
                    onPress={() => void changePrice(item, alert.suggestedCents as number)}
                  />
                ) : (
                  <Text style={styles.hint}>
                    {t(
                      alert.action === "below_cost"
                        ? "competitors.opp.belowCost"
                        : "competitors.opp.atFloor"
                    )}
                  </Text>
                )}
              </View>
            );
          })
        )}
      </Section>

      <Section
        title={
          money.totalMonthlyGainCents > 0
            ? t("competitors.opp.moneyTitle", { gain: dh(money.totalMonthlyGainCents) })
            : t("competitors.opp.moneyTitlePlain")
        }
      >
        {money.items.length === 0 ? (
          <Text style={styles.hint}>{t("competitors.opp.moneyEmpty")}</Text>
        ) : (
          money.items.map((entry) => {
            const item = entry.comparison;
            return (
              <View key={item.productId} style={styles.card}>
                <Pressable accessibilityRole="link" onPress={() => openProduct(item.productId)}>
                  <Text style={styles.name}>{item.name}</Text>
                </Pressable>
                <Text style={styles.line}>
                  {t("competitors.opp.moneyRow", {
                    ours: dh(item.sellingPriceCents),
                    target: dh(entry.targetCents),
                    shop: item.decision.offer?.shopName ?? "",
                    theirs: dh(entry.theirsCents),
                  })}
                </Text>
                <Text style={styles.hint}>
                  {t("competitors.opp.sold30d", { qty: qty(item.sold30d) })}
                </Text>
                <Text style={styles.good}>
                  {t("competitors.opp.gainPerMonth", { gain: dh(entry.monthlyGainCents) })}
                </Text>
                <BigButton
                  label={t("competitors.opp.raiseTo", { price: dh(entry.targetCents) })}
                  disabled={busy}
                  onPress={() => void changePrice(item, entry.targetCents)}
                />
              </View>
            );
          })
        )}
        {money.noSalesCount > 0 ? (
          <Text style={styles.hint}>
            {t("competitors.opp.noSales", { count: money.noSalesCount })}
          </Text>
        ) : null}
      </Section>

      <Section title={t("competitors.opp.suggestTitle")}>
        <Text style={styles.hint}>{t("competitors.opp.suggestHint")}</Text>
        {suggestions.length === 0 ? (
          <Text style={styles.hint}>{t("competitors.opp.suggestEmpty")}</Text>
        ) : (
          suggestions.map((item) => (
            <View key={item.productId} style={styles.card}>
              <Pressable accessibilityRole="link" onPress={() => openProduct(item.productId)}>
                <Text style={styles.name}>{item.name}</Text>
              </Pressable>
              <Text style={styles.hint}>
                {t("competitors.opp.suggestRow", { qty: qty(item.sold30d) })}
              </Text>
              <BigButton
                label={t("competitors.opp.markAsCheck")}
                variant="secondary"
                disabled={busy}
                onPress={() => void tag(item)}
              />
            </View>
          ))
        )}
      </Section>
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.title}>
        {title}
      </Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 12, gap: 24 },
  section: { gap: 12 },
  title: { fontSize: 18, fontWeight: "700", color: colors.ink900 },
  card: {
    gap: 8,
    padding: 12,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  name: { fontSize: 17, fontWeight: "700", color: colors.ink900 },
  line: { fontSize: 15, color: colors.ink700 },
  hint: { fontSize: 13, color: colors.ink600, lineHeight: 18 },
  bad: { fontSize: 15, fontWeight: "600", color: colors.danger700 },
  good: { fontSize: 15, fontWeight: "600", color: colors.success700 },
});
