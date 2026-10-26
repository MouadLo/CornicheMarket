import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { formatMAD } from "@/src/lib/money";
import {
  fetchMonthlyTotals,
  fetchPurchases,
  fetchSupplierTotals,
  type MonthlyTotal,
  type PurchaseSummary,
  type SupplierTotal,
} from "@/src/lib/stock/queries";

type Tab = "deliveries" | "months" | "suppliers";

export default function PurchaseHistory() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("deliveries");
  const [purchases, setPurchases] = useState<PurchaseSummary[]>([]);
  const [months, setMonths] = useState<MonthlyTotal[]>([]);
  const [bySupplier, setBySupplier] = useState<SupplierTotal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([fetchPurchases(0), fetchMonthlyTotals(), fetchSupplierTotals()])
      .then(([loadedPurchases, loadedMonths, loadedSuppliers]) => {
        setPurchases(loadedPurchases);
        setMonths(loadedMonths);
        setBySupplier(loadedSuppliers);
      })
      .catch((loadError) =>
        setError(loadError instanceof Error ? loadError.message : t('stockIn.historyLoadError'))
      )
      .finally(() => setLoading(false));
  }, [t]);

  if (loading) return <ActivityIndicator style={{ marginTop: 40 }} />;
  if (error) return <Text style={styles.error}>{error}</Text>;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.tabs}>
        <TabButton label={t('stockIn.historyTabDeliveries')} active={tab === "deliveries"} onPress={() => setTab("deliveries")} />
        <TabButton label={t('stockIn.historyTabMonths')} active={tab === "months"} onPress={() => setTab("months")} />
        <TabButton label={t('stockIn.historyTabSuppliers')} active={tab === "suppliers"} onPress={() => setTab("suppliers")} />
      </View>

      {tab === "deliveries" &&
        (purchases.length === 0 ? (
          <Text style={styles.empty}>{t('stockIn.historyEmpty')}</Text>
        ) : (
          purchases.map((purchase) => (
            <View key={purchase.id} style={styles.row}>
              <View style={styles.rowMain}>
                <Text style={styles.rowTitle}>{purchase.supplier_name ?? t('stockIn.historyNoSupplier')}</Text>
                <Text style={styles.rowMeta}>
                  {formatDate(purchase.purchase_date)} · {purchase.line_count}{" "}
                  {purchase.line_count === 1 ? t('stockIn.historyLine') : t('stockIn.historyLines')}
                  {purchase.notes ? ` · ${purchase.notes}` : ""}
                </Text>
              </View>
              <Text style={styles.rowValue}>{formatMAD(purchase.total_cents)}</Text>
            </View>
          ))
        ))}

      {tab === "months" &&
        (months.length === 0 ? (
          <Text style={styles.empty}>{t('stockIn.historyEmpty')}</Text>
        ) : (
          months.map((month) => (
            <View key={month.month} style={styles.row}>
              <View style={styles.rowMain}>
                <Text style={styles.rowTitle}>{formatMonth(month.month)}</Text>
                <Text style={styles.rowMeta}>
                  {month.purchase_count}{" "}
                  {month.purchase_count === 1 ? t('stockIn.historyDelivery') : t('stockIn.historyDeliveries')}
                </Text>
              </View>
              <Text style={styles.rowValue}>{formatMAD(month.total_cents)}</Text>
            </View>
          ))
        ))}

      {tab === "suppliers" &&
        (bySupplier.length === 0 ? (
          <Text style={styles.empty}>{t('stockIn.historyEmpty')}</Text>
        ) : (
          bySupplier.map((supplier) => (
            <View key={supplier.supplier_id ?? "none"} style={styles.row}>
              <View style={styles.rowMain}>
                <Text style={styles.rowTitle}>{supplier.supplier_name}</Text>
                <Text style={styles.rowMeta}>
                  {supplier.purchase_count}{" "}
                  {supplier.purchase_count === 1 ? t('stockIn.historyDelivery') : t('stockIn.historyDeliveries')}
                </Text>
              </View>
              <Text style={styles.rowValue}>{formatMAD(supplier.total_cents)}</Text>
            </View>
          ))
        ))}
    </ScrollView>
  );
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString();
}

function formatMonth(value: string): string {
  return new Date(value).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function TabButton({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable style={[styles.tab, active && styles.tabActive]} onPress={onPress}>
      <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 10, paddingBottom: 48 },
  tabs: { flexDirection: "row", gap: 8, marginBottom: 6 },
  tab: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 20, backgroundColor: "#eee" },
  tabActive: { backgroundColor: "#1d7a46" },
  tabText: { fontSize: 14, color: "#333" },
  tabTextActive: { color: "#fff", fontWeight: "600" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
    gap: 12,
  },
  rowMain: { flex: 1, gap: 3 },
  rowTitle: { fontSize: 16, fontWeight: "600" },
  rowMeta: { fontSize: 13, color: "#666" },
  rowValue: { fontSize: 17, fontWeight: "700" },
  empty: { textAlign: "center", marginTop: 32, color: "#666" },
  error: { padding: 20, color: "#b3261e" },
});
