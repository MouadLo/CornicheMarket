import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";

import { useAuth } from "@/src/lib/auth/AuthProvider";
import { saveTextFile } from "@/src/lib/files";
import { BigButton } from "@/src/components/BigButton";
import { fetchLowStockProducts, fetchSalesVelocity } from "@/src/lib/inventory/queries";
import { COVER_DAYS, daysOfStockLeft, suggestedReorder } from "@/src/lib/inventory/reorder";
import type { Product } from "@/src/lib/products/queries";

type Row = {
  product: Product;
  sold30d: number;
  suggested: number;
  daysLeft: number | null;
};

export default function LowStockScreen() {
  const { profile } = useAuth();
  const isOwner = profile?.role === "owner";

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const products = await fetchLowStockProducts(isOwner);
      const velocity = await fetchSalesVelocity(products.map((product) => product.id));

      setRows(
        products.map((product) => {
          const sold30d = velocity.get(product.id) ?? 0;
          return {
            product,
            sold30d,
            suggested: suggestedReorder(
              sold30d,
              product.stock_quantity,
              product.low_stock_threshold,
              product.unit
            ),
            daysLeft: daysOfStockLeft(sold30d, product.stock_quantity),
          };
        })
      );
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load low stock.");
    } finally {
      setLoading(false);
    }
  }, [isOwner]);

  useEffect(() => {
    load();
  }, [load]);

  const exportList = async () => {
    const lines = ["product,barcode,stock,sold_30d,suggested_order,unit"];
    rows.forEach((row) => {
      lines.push(
        [
          `"${row.product.name.replace(/"/g, '""')}"`,
          row.product.barcode ?? "",
          row.product.stock_quantity,
          row.sold30d,
          row.suggested,
          row.product.unit,
        ].join(",")
      );
    });
    await saveTextFile(`reorder-${new Date().toISOString().slice(0, 10)}.csv`, lines.join("\n"));
  };

  if (loading) return <ActivityIndicator style={{ marginTop: 40 }} />;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {error && <Text style={styles.error}>{error}</Text>}

      <Text style={styles.intro}>
        Suggested quantities cover {COVER_DAYS} days of the last 30 days&apos; sales, plus each
        product&apos;s low-stock threshold, minus what is on the shelf.
      </Text>

      {rows.length === 0 ? (
        <Text style={styles.empty}>Nothing is low on stock.</Text>
      ) : (
        <>
          {rows.map((row) => (
            <View key={row.product.id} style={styles.row}>
              <View style={styles.rowMain}>
                <Text style={styles.name}>{row.product.name}</Text>
                <Text style={styles.meta}>
                  {row.product.stock_quantity} {row.product.unit} left · sold {row.sold30d} in 30
                  days
                  {row.daysLeft !== null ? ` · ~${row.daysLeft.toFixed(1)} days cover` : ""}
                </Text>
              </View>
              <View style={styles.suggestBox}>
                <Text style={styles.suggestLabel}>order</Text>
                <Text style={styles.suggestValue}>{row.suggested}</Text>
              </View>
            </View>
          ))}

          <BigButton label="Export reorder list" onPress={exportList} />
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 10, paddingBottom: 48 },
  intro: { fontSize: 13, color: "#666", lineHeight: 19 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
    gap: 12,
  },
  rowMain: { flex: 1, gap: 3 },
  name: { fontSize: 16, fontWeight: "600" },
  meta: { fontSize: 13, color: "#666" },
  suggestBox: { alignItems: "center", backgroundColor: "#eef3ef", borderRadius: 10, padding: 10, minWidth: 72 },
  suggestLabel: { fontSize: 11, color: "#1d7a46", textTransform: "uppercase" },
  suggestValue: { fontSize: 20, fontWeight: "800", color: "#1d7a46" },
  empty: { textAlign: "center", color: "#666", marginTop: 32 },
  error: { color: "#b3261e" },
});
