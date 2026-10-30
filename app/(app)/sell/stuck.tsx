import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useAuth } from "@/src/lib/auth/AuthProvider";
import { formatMAD } from "@/src/lib/money";
import {
  dismissStuckSale,
  listStuckSales,
  retryStuckSale,
  type StuckSale,
} from "@/src/lib/sales/offlineQueue";
import { useSaleSync } from "@/src/lib/sales/useSaleSync";

export default function StuckSalesScreen() {
  const { profile } = useAuth();
  const { t } = useTranslation();
  const sync = useSaleSync();

  const [stuck, setStuck] = useState<StuckSale[]>([]);

  const load = useCallback(async () => {
    setStuck(await listStuckSales());
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (profile?.role !== "owner") {
    router.replace("/(app)/sell");
    return null;
  }

  const handleRetry = async (id: string) => {
    await retryStuckSale(id);
    await sync.sync();
    await load();
  };

  const handleExport = async (entry: StuckSale) => {
    const text = JSON.stringify(
      {
        id: entry.sale.id,
        date: entry.sale.created_at,
        total_MAD: (entry.sale.total_cents / 100).toFixed(2),
        payment: entry.sale.payment_method,
        error: entry.error,
        lines: entry.sale.lines.map((l) => ({
          name: l.name,
          qty: l.quantity,
          unit_price_MAD: (l.unit_price_cents / 100).toFixed(2),
        })),
      },
      null,
      2
    );
    await Share.share({ message: text, title: `Vente ${entry.sale.id.slice(0, 8)}` });
  };

  const handleDismiss = async (id: string) => {
    await dismissStuckSale(id);
    await load();
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>{t("sell.stuck.title")}</Text>

      {stuck.length === 0 && <Text style={styles.empty}>{t("sell.stuck.empty")}</Text>}

      {stuck.map((entry) => (
        <View key={entry.sale.id} style={styles.card}>
          <Text style={styles.cardDate}>
            {t("sell.stuck.date", { date: new Date(entry.sale.created_at).toLocaleString() })}
          </Text>
          <Text style={styles.cardTotal}>
            {t("sell.stuck.total", { amount: formatMAD(entry.sale.total_cents) })}
          </Text>
          <Text style={styles.cardError} numberOfLines={3}>
            {t("sell.stuck.error", { error: entry.error })}
          </Text>

          <View style={styles.actions}>
            <Pressable
              style={[styles.actionBtn, styles.retryBtn]}
              onPress={() => handleRetry(entry.sale.id)}
            >
              <Text style={styles.retryText}>{t("sell.stuck.retry")}</Text>
            </Pressable>
            <Pressable
              style={[styles.actionBtn, styles.exportBtn]}
              onPress={() => handleExport(entry)}
            >
              <Text style={styles.exportText}>{t("sell.stuck.export")}</Text>
            </Pressable>
            <Pressable style={styles.dismissBtn} onPress={() => handleDismiss(entry.sale.id)}>
              <Text style={styles.dismissText}>{t("sell.stuck.dismiss")}</Text>
            </Pressable>
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, gap: 16, paddingBottom: 60 },
  title: { fontSize: 22, fontWeight: "700" },
  empty: { color: "#555", fontSize: 15, textAlign: "center", marginTop: 40 },
  card: {
    backgroundColor: "#fff8f8",
    borderWidth: 1,
    borderColor: "#f5c0c0",
    borderRadius: 12,
    padding: 16,
    gap: 8,
  },
  cardDate: { fontSize: 13, color: "#888" },
  cardTotal: { fontSize: 18, fontWeight: "700" },
  cardError: { fontSize: 13, color: "#b3261e", fontStyle: "italic" },
  actions: { flexDirection: "row", gap: 10, alignItems: "center", marginTop: 4 },
  actionBtn: {
    minHeight: 48,
    justifyContent: "center",
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 8,
  },
  retryBtn: { backgroundColor: "#1d7a46" },
  exportBtn: { backgroundColor: "#2563eb" },
  retryText: { color: "#fff", fontWeight: "600", fontSize: 14 },
  exportText: { color: "#fff", fontWeight: "600", fontSize: 14 },
  dismissBtn: { minHeight: 48, minWidth: 48, justifyContent: "center", paddingHorizontal: 8 },
  dismissText: { color: "#888", fontSize: 14, paddingVertical: 10 },
});
