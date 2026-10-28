import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { fetchNegativeStockProducts, type NegativeStockProduct } from "@/src/lib/inventory/queries";
import { daysNegative } from "@/src/lib/inventory/reorder";
import { formatMAD } from "@/src/lib/money";

export default function NegativeStockScreen() {
  const { t } = useTranslation();

  const [rows, setRows] = useState<NegativeStockProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await fetchNegativeStockProducts());
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : t("stockIn.negativeStockLoadError")
      );
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <ActivityIndicator style={{ marginTop: 40 }} />;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {error && <Text style={styles.error}>{error}</Text>}

      <Text style={styles.intro}>{t("stockIn.negativeStockIntro")}</Text>

      {rows.length === 0 ? (
        <Text style={styles.empty}>{t("stockIn.negativeStockEmpty")}</Text>
      ) : (
        rows.map((row) => {
          const days = daysNegative(row.stock_went_negative_at);
          const value =
            row.current_cost_cents !== null ? row.stock_quantity * row.current_cost_cents : null;

          return (
            <View key={row.product_id} style={styles.row}>
              <View style={styles.rowMain}>
                <Text style={styles.name}>{row.product_name}</Text>
                <Text style={styles.meta}>
                  {t("stockIn.negativeStockQuantity", {
                    quantity: row.stock_quantity,
                    unit: row.unit,
                  })}
                  {days !== null &&
                    ` · ${t("stockIn.negativeStockSince", { days: days.toFixed(1) })}`}
                </Text>
              </View>
              {value !== null && <Text style={styles.value}>{formatMAD(Math.round(value))}</Text>}
            </View>
          );
        })
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
  meta: { fontSize: 13, color: "#b3261e" },
  value: { fontSize: 16, fontWeight: "700", color: "#b3261e" },
  empty: { textAlign: "center", color: "#666", marginTop: 32 },
  error: { color: "#b3261e" },
});
