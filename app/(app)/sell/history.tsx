import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";

import { BigButton } from "@/src/components/BigButton";
import { useAuth } from "@/src/lib/auth/AuthProvider";
import { confirmDestructive } from "@/src/lib/confirmDestructive";
import { formatMAD } from "@/src/lib/money";
import { paymentMethodKey } from "@/src/lib/sales/paymentMethod";
import { fetchRecentSales, voidSale, type SaleSummary } from "@/src/lib/sales/queries";
import { voidSaleConfirmMessage } from "@/src/lib/sales/voidConfirm";

export default function SalesHistory() {
  const { profile } = useAuth();
  const { t } = useTranslation();
  const isOwner = profile?.role === "owner";

  const [sales, setSales] = useState<SaleSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [voidingId, setVoidingId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetchRecentSales()
      .then(setSales)
      .catch((loadError) =>
        setError(loadError instanceof Error ? loadError.message : t("sell.historyLoadError"))
      )
      .finally(() => setLoading(false));
  }, [t]);

  useEffect(load, [load]);

  const handleVoid = async (saleId: string) => {
    const sale = sales.find((s) => s.id === saleId);
    if (!sale) return;
    const confirmed = await confirmDestructive(
      t("sell.voidConfirmTitle"),
      voidSaleConfirmMessage(sale.total_cents, t),
      t("sell.voidAndRestore"),
      t("common.cancel")
    );
    if (!confirmed) return;

    setSaving(true);
    setError(null);
    try {
      await voidSale(saleId, reason.trim() || t("sell.voidReason"));
      setVoidingId(null);
      setReason("");
      load();
    } catch (voidError) {
      setError(voidError instanceof Error ? voidError.message : t("sell.historyVoidError"));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <ActivityIndicator style={{ marginTop: 40 }} />;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {error && <Text style={styles.error}>{error}</Text>}
      {sales.length === 0 && <Text style={styles.empty}>{t("sell.historyEmpty")}</Text>}

      {sales.map((sale) => (
        <View key={sale.id} style={[styles.row, sale.voided_at ? styles.rowVoided : null]}>
          <View style={styles.rowTop}>
            <View style={styles.rowMain}>
              <Text style={styles.time}>{new Date(sale.created_at).toLocaleString()}</Text>
              <Text style={styles.meta}>
                {t(paymentMethodKey(sale.payment_method))}
                {sale.discount_cents > 0
                  ? ` ${t("sell.historyDiscount", { amount: formatMAD(sale.discount_cents) })}`
                  : ""}
                {sale.voided_at ? ` ${t("sell.historyVoided", { reason: sale.void_reason })}` : ""}
              </Text>
            </View>
            <Text style={[styles.total, sale.voided_at ? styles.totalVoided : null]}>
              {formatMAD(sale.total_cents)}
            </Text>
          </View>

          {isOwner &&
            !sale.voided_at &&
            (voidingId === sale.id ? (
              <View style={styles.voidBox}>
                <TextInput
                  style={styles.input}
                  value={reason}
                  onChangeText={setReason}
                  placeholder={t("sell.voidReason")}
                  autoFocus
                />
                <BigButton
                  label={saving ? t("sell.voiding") : t("sell.voidAndRestore")}
                  variant="danger"
                  onPress={() => handleVoid(sale.id)}
                  disabled={saving}
                />
                <BigButton
                  label={t("common.cancel")}
                  variant="secondary"
                  onPress={() => {
                    setVoidingId(null);
                    setReason("");
                  }}
                />
              </View>
            ) : (
              <Pressable style={styles.voidButton} onPress={() => setVoidingId(sale.id)}>
                <Text style={styles.voidButtonText}>{t("sell.voidRefund")}</Text>
              </Pressable>
            ))}
        </View>
      ))}

      {!isOwner && sales.length > 0 && <Text style={styles.note}>{t("sell.ownerOnlyVoid")}</Text>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 10, paddingBottom: 48 },
  row: { borderWidth: 1, borderColor: "#eee", borderRadius: 12, padding: 14, gap: 10 },
  rowVoided: { backgroundColor: "#fafafa", borderColor: "#e8e8e8" },
  rowTop: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  rowMain: { flex: 1, gap: 3 },
  time: { fontSize: 15, fontWeight: "600" },
  meta: { fontSize: 13, color: "#666", textTransform: "capitalize" },
  total: { fontSize: 17, fontWeight: "700" },
  totalVoided: { textDecorationLine: "line-through", color: "#999" },
  voidButton: {
    minHeight: 48,
    justifyContent: "center",
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: "#fdecea",
    alignItems: "center",
  },
  voidButtonText: { color: "#b3261e", fontWeight: "700", fontSize: 14 },
  voidBox: { gap: 10 },
  input: {
    minHeight: 52,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#ccc",
    paddingHorizontal: 16,
    fontSize: 16,
  },
  empty: { textAlign: "center", color: "#666", marginTop: 32 },
  note: { fontSize: 13, color: "#666", fontStyle: "italic", textAlign: "center", marginTop: 10 },
  error: { color: "#b3261e" },
});
