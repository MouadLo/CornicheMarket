import * as Crypto from "expo-crypto";
import { useCallback, useEffect, useRef, useState } from "react";
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
import { formatMAD, parseMoneyToCents } from "@/src/lib/money";
import {
  fetchCustomerBalances,
  recordCustomerPayment,
  type CustomerBalance,
} from "@/src/lib/sales/queries";

export default function CreditScreen() {
  const { profile } = useAuth();
  const { t } = useTranslation();
  const [balances, setBalances] = useState<CustomerBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [payingId, setPayingId] = useState<string | null>(null);
  // One id per payment the cashier is entering, reused if they tap again after
  // a network failure (the server records it once). Cleared on success, cancel,
  // switching customer, or changing the amount.
  const paymentId = useRef<string | null>(null);
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetchCustomerBalances()
      .then(setBalances)
      .catch((loadError) =>
        setError(loadError instanceof Error ? loadError.message : t("credit.loadError"))
      )
      .finally(() => setLoading(false));
  }, [t]);

  useEffect(load, [load]);

  const handlePayment = async (customerId: string) => {
    const amountCents = parseMoneyToCents(amount);
    if (!profile || amountCents === null || amountCents <= 0) return;

    setSaving(true);
    setError(null);
    try {
      paymentId.current ??= Crypto.randomUUID();
      await recordCustomerPayment(paymentId.current, customerId, amountCents, "cash");
      paymentId.current = null;
      setPayingId(null);
      setAmount("");
      load();
    } catch (payError) {
      setError(payError instanceof Error ? payError.message : t("credit.payError"));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <ActivityIndicator style={{ marginTop: 40 }} />;

  const owing = balances.filter((balance) => balance.balance_cents > 0);
  const settled = balances.filter((balance) => balance.balance_cents <= 0);
  const totalOwed = owing.reduce((sum, balance) => sum + balance.balance_cents, 0);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {error && <Text style={styles.error}>{error}</Text>}

      <View style={styles.summary}>
        <Text style={styles.summaryLabel}>{t("credit.totalOwed")}</Text>
        <Text style={styles.summaryValue}>{formatMAD(totalOwed)}</Text>
      </View>

      {owing.length === 0 && <Text style={styles.empty}>{t("credit.nobody")}</Text>}

      {owing.map((balance) => (
        <View key={balance.id} style={styles.row}>
          <View style={styles.rowTop}>
            <View style={styles.rowMain}>
              <Text style={styles.name}>{balance.name}</Text>
              <Text style={styles.meta}>
                {balance.phone ? `${balance.phone} · ` : ""}
                {t("credit.took")} {formatMAD(balance.credit_total_cents)} · {t("credit.paid")}{" "}
                {formatMAD(balance.paid_total_cents)}
              </Text>
            </View>
            <Text style={styles.balance}>{formatMAD(balance.balance_cents)}</Text>
          </View>

          {payingId === balance.id ? (
            <View style={styles.payBox}>
              <TextInput
                style={styles.input}
                value={amount}
                onChangeText={(value) => {
                  paymentId.current = null;
                  setAmount(value);
                }}
                keyboardType="decimal-pad"
                placeholder={t("credit.amountReceived")}
                autoFocus
              />
              <BigButton
                label={saving ? t("credit.recordingPayment") : t("credit.recordPayment")}
                onPress={() => handlePayment(balance.id)}
                disabled={saving}
              />
              <BigButton
                label={t("credit.cancelPayment")}
                variant="secondary"
                onPress={() => {
                  paymentId.current = null;
                  setPayingId(null);
                  setAmount("");
                }}
              />
            </View>
          ) : (
            <Pressable
              style={styles.payButton}
              onPress={() => {
                paymentId.current = null;
                setPayingId(balance.id);
                setAmount("");
              }}
            >
              <Text style={styles.payButtonText}>{t("credit.recordPaymentButton")}</Text>
            </Pressable>
          )}
        </View>
      ))}

      {settled.length > 0 && (
        <>
          <Text style={styles.sectionLabel}>{t("credit.settled")}</Text>
          {settled.map((balance) => (
            <View key={balance.id} style={styles.settledRow}>
              <Text style={styles.settledName}>{balance.name}</Text>
              <Text style={styles.settledValue}>
                {balance.balance_cents < 0
                  ? t("credit.inCredit", { amount: formatMAD(-balance.balance_cents) })
                  : t("credit.clear")}
              </Text>
            </View>
          ))}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 12, paddingBottom: 48 },
  summary: { backgroundColor: "#f3f7f4", borderRadius: 12, padding: 16, gap: 4 },
  summaryLabel: { fontSize: 14, color: "#555" },
  summaryValue: { fontSize: 28, fontWeight: "800", color: "#1d7a46" },
  row: { borderWidth: 1, borderColor: "#eee", borderRadius: 12, padding: 14, gap: 10 },
  rowTop: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  rowMain: { flex: 1, gap: 3 },
  name: { fontSize: 16, fontWeight: "700" },
  meta: { fontSize: 13, color: "#666" },
  balance: { fontSize: 18, fontWeight: "800", color: "#b3261e" },
  payButton: {
    minHeight: 48,
    justifyContent: "center",
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: "#eef3ef",
    alignItems: "center",
  },
  payButtonText: { color: "#1d7a46", fontWeight: "700", fontSize: 15 },
  payBox: { gap: 10 },
  input: {
    minHeight: 52,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#ccc",
    paddingHorizontal: 16,
    fontSize: 17,
  },
  sectionLabel: {
    fontSize: 14,
    fontWeight: "700",
    color: "#555",
    textTransform: "uppercase",
    marginTop: 10,
  },
  settledRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  settledName: { fontSize: 15 },
  settledValue: { fontSize: 14, color: "#666" },
  empty: { textAlign: "center", color: "#666", marginVertical: 20 },
  error: { color: "#b3261e" },
});
