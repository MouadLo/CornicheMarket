import { Redirect, router } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { BigButton } from "@/src/components/BigButton";
import { ComparisonCard } from "@/src/components/competitors/ComparisonCard";
import { ProductSearchPicker } from "@/src/components/stock/ProductSearchPicker";
import { Chip } from "@/src/components/ui/Chip";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { LoadError } from "@/src/components/ui/LoadError";
import { useAuth } from "@/src/lib/auth/AuthProvider";
import { applySuggestions } from "@/src/lib/competitors/applyFlow";
import { compareProducts, type ProductComparison } from "@/src/lib/competitors/overview";
import { needsReview } from "@/src/lib/competitors/pricing";
import { fetchCompetitorRows } from "@/src/lib/competitors/queries";
import { errorKey } from "@/src/lib/errors/userMessage";
import { Text } from "@/src/theme/Text";
import { colors } from "@/src/theme/tokens";

type Filter = "review" | "all" | "out";

const openProduct = (id: string) => router.push(`/(app)/competitors/${id}`);

// Owner only (a cashier is sent back to Vente): every product we track, with the
// pricing decision and a button to apply it. A product joins the list when it
// gets its first competitor link and leaves when its last link is deleted.
export default function CompetitorPrices() {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const isOwner = profile?.role === "owner";
  const [products, setProducts] = useState<ProductComparison[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("review");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);

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

  if (profile && !isOwner) return <Redirect href="/(app)/sell" />;

  const apply = async (items: ProductComparison[]) => {
    setBusy(true);
    try {
      await applySuggestions(items, t, load);
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

  const follow = (
    <View style={styles.follow}>
      <BigButton
        label={t("competitors.followProduct")}
        variant={picking ? "secondary" : "primary"}
        onPress={() => setPicking((open) => !open)}
      />
      {picking ? <ProductSearchPicker excludeIds={[]} onPick={(p) => openProduct(p.id)} /> : null}
    </View>
  );

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
      <ScrollView contentContainerStyle={styles.emptyWrap}>
        {follow}
        <EmptyState
          icon="tag"
          title={t("competitors.emptyTitle")}
          message={t("competitors.emptyHint")}
        />
      </ScrollView>
    );
  }

  const selectedItems = products.filter(
    (p) => selected.has(p.productId) && needsReview(p.decision)
  );

  return (
    <View style={styles.screen}>
      {follow}
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
            <ComparisonCard
              key={product.productId}
              product={product}
              selected={selected.has(product.productId)}
              disabled={busy}
              onToggle={() => toggle(product.productId)}
              onOpen={() => openProduct(product.productId)}
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

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  follow: { gap: 8, padding: 12, paddingBottom: 0 },
  chips: { flexDirection: "row", gap: 8, padding: 12, flexWrap: "wrap" },
  list: { padding: 12, gap: 12 },
  emptyWrap: { flexGrow: 1 },
  hint: { fontSize: 13, color: colors.ink600, lineHeight: 18 },
  footer: {
    padding: 12,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
});
