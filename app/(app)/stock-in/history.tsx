import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { BigButton } from "@/src/components/BigButton";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { LoadError } from "@/src/components/ui/LoadError";
import { useAuth } from "@/src/lib/auth/AuthProvider";
import { errorKey } from "@/src/lib/errors/userMessage";
import { formatMAD } from "@/src/lib/money";
import {
  fetchMonthlyTotals,
  fetchPurchases,
  fetchSupplierTotals,
  type MonthlyTotal,
  type PurchaseSummary,
  type SupplierTotal,
} from "@/src/lib/stock/queries";
import { Chip } from "@/src/components/ui/Chip";
import { Text } from "@/src/theme/Text";
import { colors } from "@/src/theme/tokens";

type Tab = "deliveries" | "months" | "suppliers";

export default function PurchaseHistory() {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const isOwner = profile?.role === "owner";
  const [tab, setTab] = useState<Tab>("deliveries");
  const [purchases, setPurchases] = useState<PurchaseSummary[]>([]);
  const [months, setMonths] = useState<MonthlyTotal[]>([]);
  const [bySupplier, setBySupplier] = useState<SupplierTotal[]>([]);
  const [loading, setLoading] = useState(true);
  // A translation key (see errorKey), never the server's text.
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([fetchPurchases(0), fetchMonthlyTotals(), fetchSupplierTotals()])
      .then(([loadedPurchases, loadedMonths, loadedSuppliers]) => {
        setPurchases(loadedPurchases);
        setMonths(loadedMonths);
        setBySupplier(loadedSuppliers);
      })
      .catch((failure) => setError(errorKey(failure)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  if (loading) return <ActivityIndicator style={{ marginTop: 40 }} />;
  if (error) {
    return <LoadError title={t("stockIn.historyLoadError")} reasonKey={error} onRetry={load} />;
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.tabs}>
        <TabButton
          label={t("stockIn.historyTabDeliveries")}
          active={tab === "deliveries"}
          onPress={() => setTab("deliveries")}
        />
        <TabButton
          label={t("stockIn.historyTabMonths")}
          active={tab === "months"}
          onPress={() => setTab("months")}
        />
        <TabButton
          label={t("stockIn.historyTabSuppliers")}
          active={tab === "suppliers"}
          onPress={() => setTab("suppliers")}
        />
      </View>

      {tab === "deliveries" &&
        (purchases.length === 0 ? (
          <EmptyState
            icon="truck"
            title={t("stockIn.historyEmptyTitle")}
            message={t("stockIn.historyEmptyHint")}
            action={
              isOwner ? (
                <BigButton
                  label={t("stockIn.historyEmptyAction")}
                  onPress={() => router.push("/(app)/stock-in/receive")}
                />
              ) : undefined
            }
          />
        ) : (
          purchases.map((purchase) => {
            const voided = purchase.voided_at !== null;
            return (
              <Pressable
                accessibilityRole="button"
                key={purchase.id}
                style={[styles.row, voided && styles.rowVoided]}
                onPress={() => router.push(`/(app)/stock-in/delivery/${purchase.id}` as never)}
              >
                <View style={styles.rowMain}>
                  <Text style={[styles.rowTitle, voided && styles.voidedText]}>
                    {purchase.supplier_name ?? t("stockIn.historyNoSupplier")}
                  </Text>
                  <Text style={styles.rowMeta}>
                    {formatDate(purchase.purchase_date)} · {purchase.line_count}{" "}
                    {purchase.line_count === 1
                      ? t("stockIn.historyLine")
                      : t("stockIn.historyLines")}
                    {purchase.notes ? ` · ${purchase.notes}` : ""}
                  </Text>
                  {voided && (
                    <Text style={styles.voidedTag}>
                      {t("stockIn.historyVoidedTag")} · {purchase.void_reason}
                    </Text>
                  )}
                </View>
                <Text style={[styles.rowValue, voided && styles.voidedText]}>
                  {formatMAD(purchase.total_cents)}
                </Text>
              </Pressable>
            );
          })
        ))}

      {tab === "months" &&
        (months.length === 0 ? (
          <EmptyState icon="truck" title={t("stockIn.historyEmptyTitle")} />
        ) : (
          months.map((month) => (
            <View key={month.month} style={styles.row}>
              <View style={styles.rowMain}>
                <Text style={styles.rowTitle}>{formatMonth(month.month)}</Text>
                <Text style={styles.rowMeta}>
                  {month.purchase_count}{" "}
                  {month.purchase_count === 1
                    ? t("stockIn.historyDelivery")
                    : t("stockIn.historyDeliveries")}
                </Text>
              </View>
              <Text style={styles.rowValue}>{formatMAD(month.total_cents)}</Text>
            </View>
          ))
        ))}

      {tab === "suppliers" &&
        (bySupplier.length === 0 ? (
          <EmptyState icon="truck" title={t("stockIn.historyEmptyTitle")} />
        ) : (
          bySupplier.map((supplier) => (
            <View key={supplier.supplier_id ?? "none"} style={styles.row}>
              <View style={styles.rowMain}>
                <Text style={styles.rowTitle}>{supplier.supplier_name}</Text>
                <Text style={styles.rowMeta}>
                  {supplier.purchase_count}{" "}
                  {supplier.purchase_count === 1
                    ? t("stockIn.historyDelivery")
                    : t("stockIn.historyDeliveries")}
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
  return <Chip label={label} selected={active} onPress={onPress} />;
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 10, paddingBottom: 48 },
  tabs: { flexDirection: "row", gap: 8, marginBottom: 6 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    gap: 12,
  },
  rowVoided: { opacity: 0.85 },
  voidedText: { textDecorationLine: "line-through", color: colors.ink600 },
  voidedTag: { fontSize: 13, color: colors.danger600, fontWeight: "700" },
  rowMain: { flex: 1, gap: 3 },
  rowTitle: { fontSize: 16, fontWeight: "600" },
  rowMeta: { fontSize: 13, color: colors.ink600 },
  rowValue: { fontSize: 17, fontWeight: "700" },
});
