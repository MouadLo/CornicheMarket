import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { CompetitorSection } from "@/src/components/competitors/CompetitorSection";
import { ComparisonCard } from "@/src/components/competitors/ComparisonCard";
import { Icon } from "@/src/components/ui/Icon";
import { LoadError } from "@/src/components/ui/LoadError";
import { Money } from "@/src/components/ui/Money";
import { useAuth } from "@/src/lib/auth/AuthProvider";
import { applySuggestions } from "@/src/lib/competitors/applyFlow";
import { compareProducts, type ProductComparison } from "@/src/lib/competitors/overview";
import { fetchCompetitorRows } from "@/src/lib/competitors/queries";
import { errorKey } from "@/src/lib/errors/userMessage";
import { fetchProduct, type Product } from "@/src/lib/products/queries";
import { Text } from "@/src/theme/Text";
import { colors } from "@/src/theme/tokens";

// Owner only: one product's competitor page. The decision card is the same one
// the list shows; below it, the links (add, check, manual price, margin floor).
export default function CompetitorProduct() {
  const { productId } = useLocalSearchParams<{ productId: string }>();
  const { t } = useTranslation();
  const { profile } = useAuth();
  const isOwner = profile?.role === "owner";
  const [comparison, setComparison] = useState<ProductComparison | null>(null);
  const [product, setProduct] = useState<Product | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!productId) return;
    setLoadError(null);
    try {
      const [rows, found] = await Promise.all([
        fetchCompetitorRows(productId),
        fetchProduct(productId, true),
      ]);
      setComparison(compareProducts(rows, Date.now())[0] ?? null);
      setProduct(found);
      setLoaded(true);
    } catch (failure) {
      setLoadError(errorKey(failure));
    }
  }, [productId]);

  useEffect(() => {
    if (isOwner) void load();
  }, [isOwner, load]);

  if (profile && !isOwner) return <Redirect href="/(app)/sell" />;
  if (loadError) {
    return (
      <LoadError
        title={t("competitors.loadErrorScreen")}
        reasonKey={loadError}
        onRetry={() => void load()}
      />
    );
  }
  if (!loaded) return <ActivityIndicator style={{ marginTop: 40 }} />;
  if (!product) return <Text style={styles.pad}>{t("products.formProductNotFound")}</Text>;

  const apply = async (item: ProductComparison) => {
    setBusy(true);
    try {
      await applySuggestions([item], t, load);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.content}>
      {comparison ? (
        <ComparisonCard
          product={comparison}
          disabled={busy}
          onApply={() => void apply(comparison)}
        />
      ) : (
        // Nothing tracked yet: no decision to make, just the product's numbers.
        <View style={styles.card}>
          <Text style={styles.name}>{product.name}</Text>
          <View style={styles.grid}>
            <View style={styles.cell}>
              <Text style={styles.label}>{t("competitors.ourPrice")}</Text>
              <Money cents={product.selling_price_cents} />
            </View>
            <View style={styles.cell}>
              <Text style={styles.label}>{t("competitors.cost")}</Text>
              {product.current_cost_cents ? (
                <Money cents={product.current_cost_cents} />
              ) : (
                <Text>-</Text>
              )}
            </View>
          </View>
        </View>
      )}

      <CompetitorSection productId={product.id} onChanged={load} />

      <Pressable
        accessibilityRole="link"
        style={styles.link}
        onPress={() => router.push(`/(app)/products/${product.id}`)}
      >
        <Text style={styles.linkText}>{t("competitors.viewProduct")}</Text>
        <Icon name="chevron" size={18} color={colors.brand700} />
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 12, gap: 16 },
  pad: { padding: 20 },
  card: {
    gap: 12,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  name: { fontSize: 17, fontWeight: "700", color: colors.ink900 },
  grid: { flexDirection: "row", gap: 12, flexWrap: "wrap" },
  cell: { flexGrow: 1, flexBasis: 100, gap: 2 },
  label: { fontSize: 13, color: colors.ink600 },
  link: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 8 },
  linkText: { fontSize: 16, fontWeight: "600", color: colors.brand700 },
});
