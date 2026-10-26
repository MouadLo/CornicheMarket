import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

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
  const { t } = useTranslation();
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
      setError(loadError instanceof Error ? loadError.message : t('stockIn.lowStockLoadError'));
    } finally {
      setLoading(false);
    }
  }, [isOwner, t]);

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

      <Text style={styles.intro}>{t('stockIn.lowStockIntro', { days: COVER_DAYS })}</Text>

      {rows.length === 0 ? (
        <Text style={styles.empty}>{t('stockIn.lowStockEmpty')}</Text>
      ) : (
        <>
          {rows.map((row) => (
            <View key={row.product.id} style={styles.row}>
              <View style={styles.rowMain}>
                <Text style={styles.name}>{row.product.name}</Text>
                <Text style={styles.meta}>
                  {t('stockIn.lowStockLeft', { stock: row.product.stock_quantity, unit: row.product.unit })}
                  {' · '}
                  {t('stockIn.lowStockSold30d', { count: row.sold30d })}
                  {row.daysLeft !== null
                    ? ` · ${t('stockIn.lowStockDaysCover', { days: row.daysLeft.toFixed(1) })}`
                    : ""}
                </Text>
              </View>
              <View style={styles.suggestBox}>
                <Text style={styles.suggestLabel}>{t('stockIn.lowStockOrder')}</Text>
                <Text style={styles.suggestValue}>{row.suggested}</Text>
              </View>
            </View>
          ))}

          <BigButton label={t('stockIn.lowStockExport')} onPress={exportList} />
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
