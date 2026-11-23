import { Redirect, router } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { BigButton } from "@/src/components/BigButton";
import { agoText } from "@/src/components/competitors/CompetitorSection";
import { Chip } from "@/src/components/ui/Chip";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { Icon } from "@/src/components/ui/Icon";
import { LoadError } from "@/src/components/ui/LoadError";
import { Money } from "@/src/components/ui/Money";
import { StatusPill } from "@/src/components/ui/StatusPill";
import { useAuth } from "@/src/lib/auth/AuthProvider";
import { compareProducts, type ProductComparison } from "@/src/lib/competitors/overview";
import {
  bpToDisplay,
  cheaperPercent,
  needsReview,
  type Outcome,
} from "@/src/lib/competitors/pricing";
import { applyCompetitorSuggestions, fetchCompetitorRows } from "@/src/lib/competitors/queries";
import { showToast } from "@/src/lib/dialog/store";
import { errorKey, errorKeyOr } from "@/src/lib/errors/userMessage";
import { formatMAD } from "@/src/lib/money";
import { undoPriceChange } from "@/src/lib/products/queries";
import { isolateLtr } from "@/src/lib/text/bidi";
import { Text } from "@/src/theme/Text";
import { colors, radius } from "@/src/theme/tokens";
import type { Tone } from "@/src/theme/tones";

type Filter = "review" | "all" | "out";

const OUTCOME: Record<
  Outcome,
  { tone: Tone; icon: "check" | "tag" | "alert" | "x" | "info" | "minus"; key: string }
> = {
  ok: { tone: "ok", icon: "check", key: "ok" },
  lower: { tone: "warn", icon: "tag", key: "lower" },
  floor: { tone: "warn", icon: "alert", key: "floor" },
  dont_follow: { tone: "bad", icon: "x", key: "dontFollow" },
  could_raise: { tone: "info", icon: "info", key: "raise" },
  no_data: { tone: "neutral", icon: "minus", key: "noData" },
  no_cost: { tone: "neutral", icon: "minus", key: "noCost" },
};

const dh = (cents: number) => isolateLtr(formatMAD(cents));
const pct = (bp: number) => isolateLtr(`${bpToDisplay(bp)} %`);

// Owner only (a cashier is sent back to Products): one row per product that has
// competitor links, with the pricing decision and a button to apply it.
export default function CompetitorPrices() {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const isOwner = profile?.role === "owner";
  const [products, setProducts] = useState<ProductComparison[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("review");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setProducts(compareProducts(await fetchCompetitorRows(), Date.now()));
      setSelected(new Set());
    } catch (failure) {
      setLoadError(errorKey(failure));
    }
  }, []);

  useEffect(() => {
    if (isOwner) void load();
  }, [isOwner, load]);

  const shown = useMemo(() => {
    if (!products) return [];
    if (filter === "review") return products.filter((p) => needsReview(p.decision));
    if (filter === "out") return products.filter((p) => p.anyOutOfStock);
    return products;
  }, [products, filter]);

  if (profile && !isOwner) return <Redirect href="/(app)/products" />;

  const apply = async (items: ProductComparison[]) => {
    const prices = items
      .filter((p) => p.decision.suggestedCents !== null)
      .map((p) => ({ productId: p.productId, priceCents: p.decision.suggestedCents as number }));
    if (prices.length === 0) return;
    setBusy(true);
    try {
      const result = await applyCompetitorSuggestions(prices);
      if (result.changed === 0 || !result.batchId) {
        showToast({ text: t("competitors.appliedNothing"), tone: "info" });
      } else {
        const batchId = result.batchId;
        showToast({
          text:
            result.changed === 1
              ? t("competitors.applied")
              : t("competitors.appliedMany", { count: result.changed }),
          tone: "success",
          duration: 10000,
          action: {
            label: t("competitors.applyUndo"),
            onPress: () => {
              undoPriceChange(batchId)
                .then(() => {
                  showToast({ text: t("competitors.undone"), tone: "success" });
                  return load();
                })
                .catch((failure) =>
                  showToast({
                    text: t(errorKeyOr(failure, "competitors.applyError")),
                    tone: "info",
                  })
                );
            },
          },
        });
      }
      await load();
    } catch (failure) {
      showToast({ text: t(errorKeyOr(failure, "competitors.applyError")), tone: "info" });
    } finally {
      setBusy(false);
    }
  };

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

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
  if (products.length === 0) {
    return (
      <EmptyState
        icon="tag"
        title={t("competitors.emptyTitle")}
        message={t("competitors.emptyHint")}
      />
    );
  }

  const selectedItems = products.filter(
    (p) => selected.has(p.productId) && needsReview(p.decision)
  );

  return (
    <View style={styles.screen}>
      <View style={styles.chips}>
        <Chip
          label={t("competitors.filterReview")}
          selected={filter === "review"}
          onPress={() => setFilter("review")}
        />
        <Chip
          label={t("competitors.filterAll")}
          selected={filter === "all"}
          onPress={() => setFilter("all")}
        />
        <Chip
          label={t("competitors.filterOut")}
          selected={filter === "out"}
          onPress={() => setFilter("out")}
        />
      </View>
      <ScrollView contentContainerStyle={styles.list}>
        {shown.length === 0 ? (
          <Text style={styles.hint}>{t("competitors.nothingToReview")}</Text>
        ) : (
          shown.map((product) => (
            <ProductCard
              key={product.productId}
              product={product}
              selected={selected.has(product.productId)}
              disabled={busy}
              onToggle={() => toggle(product.productId)}
              onApply={() => void apply([product])}
            />
          ))
        )}
      </ScrollView>
      {selectedItems.length > 0 ? (
        <View style={styles.footer}>
          <BigButton
            label={t("competitors.applySelected", { count: selectedItems.length })}
            onPress={() => void apply(selectedItems)}
            disabled={busy}
          />
        </View>
      ) : null}
    </View>
  );
}

function ProductCard({
  product,
  selected,
  disabled,
  onToggle,
  onApply,
}: {
  product: ProductComparison;
  selected: boolean;
  disabled: boolean;
  onToggle: () => void;
  onApply: () => void;
}) {
  const { t } = useTranslation();
  const { decision } = product;
  const offer = decision.offer;
  const spec = OUTCOME[decision.outcome];
  const suggested = decision.suggestedCents;
  const reviewable = needsReview(decision);
  const floor = pct(product.minMarginBp);

  const label = t(
    `competitors.outcome.${decision.outcome === "floor" && suggested === null ? "floorStay" : spec.key}`,
    { price: suggested === null ? "" : dh(suggested) }
  );
  const why = (() => {
    switch (decision.outcome) {
      case "lower":
        return t("competitors.why.lower", { margin: pct(decision.marginIfMatchedBp ?? 0), floor });
      case "floor":
        return suggested === null
          ? t("competitors.why.floorStay", { floor })
          : t("competitors.why.floor", { margin: pct(decision.marginIfMatchedBp ?? 0), floor });
      case "could_raise":
        return t("competitors.why.raise", {
          percent: isolateLtr(
            `${cheaperPercent(product.sellingPriceCents, offer?.priceCents ?? 0)} %`
          ),
          shop: offer?.shopName ?? "",
        });
      case "ok":
        return t("competitors.why.ok");
      case "dont_follow":
        return t("competitors.why.dontFollow");
      case "no_cost":
        return t("competitors.why.noCost");
      default:
        return t("competitors.why.noData");
    }
  })();

  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        {reviewable ? (
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: selected }}
            accessibilityLabel={t("competitors.select", { name: product.name })}
            onPress={onToggle}
            style={[styles.check, selected && styles.checkOn]}
          >
            {selected ? <Icon name="check" size={18} color={colors.white} /> : null}
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="link"
          style={styles.flex}
          onPress={() => router.push(`/(app)/products/${product.productId}`)}
        >
          <Text style={styles.name}>{product.name}</Text>
        </Pressable>
        <Text style={styles.hint}>{t("competitors.links", { count: product.offers.length })}</Text>
      </View>

      <View style={styles.grid}>
        <Cell label={t("competitors.cost")}>
          {product.costCents !== null && product.costCents > 0 ? (
            <Money cents={product.costCents} />
          ) : (
            <Text>-</Text>
          )}
        </Cell>
        <Cell label={t("competitors.ourPrice")}>
          <Money cents={product.sellingPriceCents} />
        </Cell>
        <Cell label={t("competitors.margin")}>
          <Text>{decision.currentMarginBp === null ? "-" : pct(decision.currentMarginBp)}</Text>
        </Cell>
      </View>

      {offer && offer.priceCents !== null ? (
        <View style={styles.grid}>
          <Cell label={t("competitors.cheapest")}>
            <Text style={styles.shop}>{offer.shopName}</Text>
            <View style={styles.priceRow}>
              <Money cents={offer.priceCents} />
              {decision.promo ? (
                <StatusPill label={t("competitors.promo")} tone="warn" icon="tag" />
              ) : null}
            </View>
            <Text style={styles.hint}>{agoText(offer.checkedAt, t) ?? ""}</Text>
          </Cell>
          <Cell label={t("competitors.gap")}>
            <Text>
              {decision.gapCents === null
                ? "-"
                : isolateLtr(
                    `${decision.gapCents > 0 ? "+" : decision.gapCents < 0 ? "-" : ""}${formatMAD(Math.abs(decision.gapCents))}`
                  )}
            </Text>
          </Cell>
          <Cell label={t("competitors.ifMatched")}>
            <Text>
              {decision.marginIfMatchedBp === null ? "-" : pct(decision.marginIfMatchedBp)}
            </Text>
          </Cell>
        </View>
      ) : null}

      <View style={styles.outcome}>
        <StatusPill label={label} tone={spec.tone} icon={spec.icon} />
        <Text style={styles.why}>{why}</Text>
        {reviewable ? (
          <BigButton label={t("competitors.apply")} onPress={onApply} disabled={disabled} />
        ) : null}
      </View>
    </View>
  );
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.cell}>
      <Text style={styles.cellLabel}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  chips: { flexDirection: "row", gap: 8, padding: 12, flexWrap: "wrap" },
  list: { padding: 12, gap: 12 },
  hint: { fontSize: 13, color: colors.ink600, lineHeight: 18 },
  flex: { flex: 1 },
  card: {
    gap: 12,
    padding: 12,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  check: {
    width: 28,
    height: 28,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.ink400,
    alignItems: "center",
    justifyContent: "center",
  },
  checkOn: { backgroundColor: colors.brand700, borderColor: colors.brand700 },
  name: { fontSize: 17, fontWeight: "700", color: colors.ink900 },
  grid: { flexDirection: "row", gap: 12, flexWrap: "wrap" },
  cell: { flexGrow: 1, flexBasis: 100, gap: 2 },
  cellLabel: { fontSize: 13, color: colors.ink600 },
  shop: { fontSize: 14, fontWeight: "600", color: colors.ink900 },
  priceRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  outcome: { gap: 8, alignItems: "flex-start" },
  why: { fontSize: 14, color: colors.ink700, lineHeight: 20 },
  footer: {
    padding: 12,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
});
