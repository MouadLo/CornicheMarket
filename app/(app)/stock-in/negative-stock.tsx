import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { EmptyState } from "@/src/components/ui/EmptyState";
import { LoadError } from "@/src/components/ui/LoadError";
import { errorKey } from "@/src/lib/errors/userMessage";

import { fetchNegativeStockProducts, type NegativeStockProduct } from "@/src/lib/inventory/queries";
import { daysNegative } from "@/src/lib/inventory/reorder";
import { formatMAD } from "@/src/lib/money";
import { Text } from "@/src/theme/Text";
import { colors } from "@/src/theme/tokens";

export default function NegativeStockScreen() {
  const { t } = useTranslation();

  const [rows, setRows] = useState<NegativeStockProduct[]>([]);
  const [loading, setLoading] = useState(true);
  // A translation key (see errorKey), never the server's text.
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await fetchNegativeStockProducts());
    } catch (failure) {
      setError(errorKey(failure));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <ActivityIndicator style={{ marginTop: 40 }} />;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.intro}>{t("stockIn.negativeStockIntro")}</Text>

      {error ? (
        <LoadError title={t("stockIn.negativeStockLoadError")} reasonKey={error} onRetry={load} />
      ) : rows.length === 0 ? (
        <EmptyState icon="check" title={t("stockIn.negativeStockEmpty")} />
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
  intro: { fontSize: 13, color: colors.ink600, lineHeight: 19 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    gap: 12,
  },
  rowMain: { flex: 1, gap: 3 },
  name: { fontSize: 16, fontWeight: "600" },
  meta: { fontSize: 13, color: colors.danger600 },
  value: { fontSize: 16, fontWeight: "700", color: colors.danger600 },
  empty: { textAlign: "center", color: colors.ink600, marginTop: 32 },
  error: { color: colors.danger600 },
});
