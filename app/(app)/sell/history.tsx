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
import { VoidRequestSheet } from "@/src/components/sell/VoidRequestSheet";
import { StatusPill } from "@/src/components/ui/StatusPill";
import { useAuth } from "@/src/lib/auth/AuthProvider";
import { confirmDestructive } from "@/src/lib/confirmDestructive";
import { formatMAD } from "@/src/lib/money";
import { paymentMethodKey } from "@/src/lib/sales/paymentMethod";
import { fetchRecentSales, voidSale, type SaleSummary } from "@/src/lib/sales/queries";
import { voidSaleConfirmMessage } from "@/src/lib/sales/voidConfirm";
import {
  describeVoidRequestError,
  fetchMyVoidRequests,
  latestRequestBySale,
  requestVoid,
  type MyVoidRequest,
  type VoidReason,
} from "@/src/lib/sales/voidRequests";

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
  // Cashier: the sale being asked about, and what the owner has answered so far.
  const [askingId, setAskingId] = useState<string | null>(null);
  const [askError, setAskError] = useState<string | null>(null);
  const [requests, setRequests] = useState<Map<string, MyVoidRequest>>(new Map());

  const load = useCallback(() => {
    setLoading(true);
    // The status badges are a nicety: if they cannot load, the list still shows.
    if (!isOwner) {
      fetchMyVoidRequests()
        .then((list) => setRequests(latestRequestBySale(list)))
        .catch(() => {});
    }
    fetchRecentSales()
      .then(setSales)
      .catch((loadError) =>
        setError(loadError instanceof Error ? loadError.message : t("sell.historyLoadError"))
      )
      .finally(() => setLoading(false));
  }, [t, isOwner]);

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

  const handleAsk = async (saleId: string, reasonCode: VoidReason, note: string) => {
    setSaving(true);
    setAskError(null);
    try {
      await requestVoid(saleId, reasonCode, note);
      setAskingId(null);
      load();
    } catch (askFailure) {
      setAskError(describeVoidRequestError(askFailure, t));
    } finally {
      setSaving(false);
    }
  };

  // Cashier: a status once the owner has been asked, otherwise the ask button.
  const renderAsk = (saleId: string) => {
    const request = requests.get(saleId);
    if (request?.status === "pending") {
      return <StatusPill label={t("sell.voidRequested")} tone="warn" icon="clock" />;
    }
    return (
      <View style={styles.voidBox}>
        {request?.status === "refused" ? (
          <>
            <StatusPill label={t("sell.voidRefused")} tone="bad" icon="x" />
            {request.refusalNote ? (
              <Text style={styles.refusal}>
                {t("sell.voidRefusedNote", { note: request.refusalNote })}
              </Text>
            ) : null}
          </>
        ) : null}
        <Pressable
          accessibilityRole="button"
          style={styles.voidButton}
          onPress={() => {
            setAskError(null);
            setAskingId(saleId);
          }}
        >
          <Text style={styles.voidButtonText}>{t("sell.askVoid")}</Text>
        </Pressable>
      </View>
    );
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

          {!isOwner && !sale.voided_at && (!sale.cashier_id || sale.cashier_id === profile?.id)
            ? renderAsk(sale.id)
            : null}
        </View>
      ))}

      {askingId && (
        <VoidRequestSheet
          key={askingId}
          visible
          amountLabel={formatMAD(sales.find((s) => s.id === askingId)?.total_cents ?? 0)}
          saving={saving}
          error={askError}
          onSubmit={(reasonCode, note) => handleAsk(askingId, reasonCode, note)}
          onClose={() => setAskingId(null)}
        />
      )}
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
  refusal: { fontSize: 14, color: "#666" },
  error: { color: "#b3261e" },
});
