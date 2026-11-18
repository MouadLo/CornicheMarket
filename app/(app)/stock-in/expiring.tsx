import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { EmptyState } from "@/src/components/ui/EmptyState";
import { LoadError } from "@/src/components/ui/LoadError";
import { errorKey } from "@/src/lib/errors/userMessage";

import { fetchExpiringBatches, type ExpiringBatch } from "@/src/lib/inventory/queries";
import { EXPIRING_DEFAULT_DAYS } from "@/src/lib/inventory/stockHome";

const RANGES = [7, 30, 90];

export default function ExpiringScreen() {
  const { t } = useTranslation();
  const [withinDays, setWithinDays] = useState<number>(EXPIRING_DEFAULT_DAYS);
  const [batches, setBatches] = useState<ExpiringBatch[]>([]);
  const [loading, setLoading] = useState(true);
  // A translation key (see errorKey), never the server's text.
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchExpiringBatches(withinDays)
      .then(setBatches)
      .catch((failure) => setError(errorKey(failure)))
      .finally(() => setLoading(false));
  }, [withinDays]);

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

      {loading ? (
        <ActivityIndicator style={{ marginTop: 24 }} />
      ) : error ? (
        <LoadError title={t("stockIn.expiringLoadError")} reasonKey={error} onRetry={load} />
      ) : batches.length === 0 ? (
        <EmptyState icon="check" title={t("stockIn.expiringNone", { days: withinDays })} />
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
  date: { fontSize: 13, color: "#777" },
  empty: { textAlign: "center", color: "#666", marginVertical: 24, lineHeight: 20 },
  note: { fontSize: 13, color: "#777", fontStyle: "italic", marginTop: 16, lineHeight: 19 },
  error: { color: "#b3261e" },
});
