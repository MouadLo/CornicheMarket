import { Redirect, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";

import { PriceHistoryChart } from "@/src/components/stock/PriceHistoryChart";
import { useAuth } from "@/src/lib/auth/AuthProvider";
import { formatMAD, formatMargin, marginPercent } from "@/src/lib/money";
import { fetchProduct, type Product } from "@/src/lib/products/queries";
import { fetchPriceHistory, type PricePoint } from "@/src/lib/stock/queries";
import { priceChangePercent } from "@/src/lib/stock/pricing";

export default function ProductPriceHistory() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { profile } = useAuth();
  const isOwner = profile?.role === "owner";

  const [product, setProduct] = useState<Product | null>(null);
  const [points, setPoints] = useState<PricePoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id || !isOwner) return;

    Promise.all([fetchProduct(id, true), fetchPriceHistory(id)])
      .then(([loadedProduct, loadedPoints]) => {
        setProduct(loadedProduct);
        setPoints(loadedPoints);
      })
      .catch((loadError) =>
        setError(loadError instanceof Error ? loadError.message : "Could not load history.")
      )
      .finally(() => setLoading(false));
  }, [id, isOwner]);

  if (profile && !isOwner) return <Redirect href="/(app)/products" />;
  if (loading) return <ActivityIndicator style={{ marginTop: 40 }} />;
  if (error) return <Text style={styles.error}>{error}</Text>;
  if (!product) return <Text style={styles.error}>Product not found.</Text>;

  const first = points[0]?.unit_cost_cents ?? null;
  const latest = points[points.length - 1]?.unit_cost_cents ?? null;
  const overallChange =
    first !== null && latest !== null ? priceChangePercent(first, latest) : null;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>{product.name}</Text>
      <Text style={styles.subtitle}>Buying price per delivery</Text>

      <PriceHistoryChart points={points} averageCostCents={product.current_cost_cents} />

      <View style={styles.stats}>
        <Stat label="Sells at" value={formatMAD(product.selling_price_cents)} />
        <Stat
          label="Average cost"
          value={
            product.current_cost_cents && product.current_cost_cents > 0
              ? formatMAD(product.current_cost_cents)
              : "—"
          }
        />
        <Stat
          label="Margin now"
          value={formatMargin(
            marginPercent(product.selling_price_cents, product.current_cost_cents ?? 0)
          )}
        />
        {overallChange !== null && points.length > 1 && (
          <Stat
            label="Since first delivery"
            value={`${overallChange >= 0 ? "+" : ""}${overallChange.toFixed(1)}%`}
            negative={overallChange > 0}
          />
        )}
      </View>

      {points.length > 0 && (
        <>
          <Text style={styles.sectionLabel}>Deliveries</Text>
          {[...points].reverse().map((point) => (
            <View key={point.id} style={styles.row}>
              <Text style={styles.rowDate}>
                {new Date(point.created_at).toLocaleDateString()}
              </Text>
              <Text style={styles.rowQty}>
                {point.quantity} {product.unit}
              </Text>
              <Text style={styles.rowPrice}>{formatMAD(point.unit_cost_cents)}</Text>
            </View>
          ))}
        </>
      )}

      <Text style={styles.note}>
        The average cost blends every delivery still counted in stock, which is what profit on a
        sale is measured against.
      </Text>
    </ScrollView>
  );
}

function Stat({
  label,
  value,
  negative,
}: {
  label: string;
  value: string;
  negative?: boolean;
}) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, negative && styles.statNegative]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, gap: 14, paddingBottom: 48 },
  title: { fontSize: 22, fontWeight: "700" },
  subtitle: { fontSize: 14, color: "#666" },
  stats: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  stat: {
    backgroundColor: "#f4f6f5",
    borderRadius: 10,
    padding: 12,
    minWidth: 120,
    flexGrow: 1,
    gap: 4,
  },
  statLabel: { fontSize: 12, color: "#666", textTransform: "uppercase" },
  statValue: { fontSize: 18, fontWeight: "700" },
  statNegative: { color: "#b3261e" },
  sectionLabel: { fontSize: 14, fontWeight: "700", color: "#555", textTransform: "uppercase" },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
    gap: 10,
  },
  rowDate: { fontSize: 14, flex: 1 },
  rowQty: { fontSize: 14, color: "#666" },
  rowPrice: { fontSize: 15, fontWeight: "600" },
  note: { fontSize: 13, color: "#666", fontStyle: "italic", marginTop: 8 },
  error: { padding: 20, color: "#b3261e" },
});
