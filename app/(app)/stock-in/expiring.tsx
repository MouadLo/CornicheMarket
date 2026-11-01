import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { fetchExpiringBatches, type ExpiringBatch } from "@/src/lib/inventory/queries";

const RANGES = [7, 30, 90];

export default function ExpiringScreen() {
  const { t } = useTranslation();
  const [withinDays, setWithinDays] = useState(30);
  const [batches, setBatches] = useState<ExpiringBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetchExpiringBatches(withinDays)
      .then(setBatches)
      .catch((loadError) =>
        setError(loadError instanceof Error ? loadError.message : t("stockIn.expiringLoadError"))
      )
      .finally(() => setLoading(false));
  }, [withinDays, t]);

  useEffect(load, [load]);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.chips}>
        {RANGES.map((range) => (
          <Pressable
            key={range}
            style={[styles.chip, withinDays === range && styles.chipActive]}
            onPress={() => setWithinDays(range)}
          >
            <Text style={[styles.chipText, withinDays === range && styles.chipTextActive]}>
              {t("stockIn.expiringNext", { days: range })}
            </Text>
          </Pressable>
        ))}
      </View>

      {error && <Text style={styles.error}>{error}</Text>}
      {loading ? (
        <ActivityIndicator style={{ marginTop: 24 }} />
      ) : batches.length === 0 ? (
        <Text style={styles.empty}>{t("stockIn.expiringNone", { days: withinDays })}</Text>
      ) : (
        batches.map((batch) => {
          const expired = batch.days_left < 0;
          const urgent = batch.days_left <= 7;

          return (
            <View key={batch.id} style={styles.row}>
              <View style={styles.rowMain}>
                <Text style={styles.name}>{batch.product_name}</Text>
                <Text style={styles.meta}>
                  {t("stockIn.expiringDelivered")} {batch.delivered_quantity} {batch.unit} ·{" "}
                  {batch.stock_quantity} {t("stockIn.expiringInStock")}
                </Text>
              </View>
              <View style={styles.right}>
                <Text style={[styles.days, expired && styles.expired, urgent && styles.urgent]}>
                  {expired
                    ? t("stockIn.expiringDaysAgo", { days: Math.abs(batch.days_left) })
                    : batch.days_left === 0
                      ? t("stockIn.expiringToday")
                      : `${batch.days_left}d`}
                </Text>
                <Text style={styles.date}>{batch.expiry_date}</Text>
              </View>
            </View>
          );
        })
      )}

      <Text style={styles.note}>{t("stockIn.expiringNote")}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 10, paddingBottom: 48 },
  chips: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  chip: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 20, backgroundColor: "#eee" },
  chipActive: { backgroundColor: "#1d7a46" },
  chipText: { fontSize: 14, color: "#333" },
  chipTextActive: { color: "#fff", fontWeight: "600" },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
    gap: 12,
  },
  rowMain: { flex: 1, gap: 3 },
  name: { fontSize: 16, fontWeight: "600" },
  meta: { fontSize: 13, color: "#666" },
  right: { alignItems: "flex-end" },
  days: { fontSize: 17, fontWeight: "800", color: "#1d7a46" },
  urgent: { color: "#b36b00" },
  expired: { color: "#b3261e" },
  date: { fontSize: 12, color: "#777" },
  empty: { textAlign: "center", color: "#666", marginVertical: 24, lineHeight: 20 },
  note: { fontSize: 12, color: "#777", fontStyle: "italic", marginTop: 16, lineHeight: 18 },
  error: { color: "#b3261e" },
});
