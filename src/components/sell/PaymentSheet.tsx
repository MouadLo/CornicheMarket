import { useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";

import { BigButton } from "@/src/components/BigButton";
import { centsToDisplay, formatMAD, parseMoneyToCents } from "@/src/lib/money";
import { paymentMethodKey } from "@/src/lib/sales/paymentMethod";
import { changeDue, isShortPayment } from "@/src/lib/sales/totals";
import type { Customer, PaymentMethod } from "@/src/lib/sales/queries";
import { colors, radius } from "@/src/theme/tokens";
import { Text } from "@/src/theme/Text";

type Props = {
  visible: boolean;
  totalCents: number;
  customers: Customer[];
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (method: PaymentMethod, customerId: string | null) => void;
  onCreateCustomer: (name: string) => Promise<Customer | null>;
};

const METHODS: PaymentMethod[] = ["cash", "card", "credit"];

export function PaymentSheet({
  visible,
  totalCents,
  customers,
  saving,
  error,
  onClose,
  onConfirm,
  onCreateCustomer,
}: Props) {
  const { t } = useTranslation();
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [tendered, setTendered] = useState("");
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [newCustomer, setNewCustomer] = useState("");

  // The sheet stays mounted between sales, so its state would otherwise carry
  // over: after a credit sale the next customer's sheet opened on "Pay later"
  // with the previous customer selected, one tap from putting a stranger's
  // basket on their credit. Every opening starts from cash, no customer, no
  // amount. Done while rendering (not in an effect) so a stale choice is never
  // painted, even for one frame.
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setMethod("cash");
      setTendered("");
      setCustomerId(null);
      setNewCustomer("");
    }
  }

  const tenderedCents = parseMoneyToCents(tendered) ?? 0;
  const short = method === "cash" && tendered !== "" && isShortPayment(tenderedCents, totalCents);
  const change = changeDue(tenderedCents, totalCents);
  const needsCustomer = method === "credit" && !customerId;

  const handleCreateCustomer = async () => {
    if (!newCustomer.trim()) return;
    const created = await onCreateCustomer(newCustomer.trim());
    if (created) {
      setCustomerId(created.id);
      setNewCustomer("");
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <ScrollView style={styles.sheet} contentContainerStyle={styles.sheetContent}>
          <Text style={styles.total}>{formatMAD(totalCents)}</Text>

          <View style={styles.methods}>
            {METHODS.map((value) => (
              <Pressable
                key={value}
                style={[styles.method, method === value && styles.methodActive]}
                onPress={() => setMethod(value)}
              >
                <Text style={[styles.methodText, method === value && styles.methodTextActive]}>
                  {value === "credit" ? t("sell.payLater") : t(paymentMethodKey(value))}
                </Text>
              </Pressable>
            ))}
          </View>

          {method === "cash" && (
            <View style={styles.block}>
              <Text style={styles.label}>{t("sell.cashReceived")}</Text>
              <TextInput
                style={styles.input}
                value={tendered}
                onChangeText={setTendered}
                keyboardType="decimal-pad"
                placeholder={centsToDisplay(totalCents)}
              />
              <View style={styles.quickRow}>
                {quickAmounts(totalCents).map((amount) => (
                  <Pressable
                    key={amount}
                    style={styles.quick}
                    onPress={() => setTendered(centsToDisplay(amount))}
                  >
                    <Text style={styles.quickText}>{centsToDisplay(amount)}</Text>
                  </Pressable>
                ))}
              </View>

              {short ? (
                <Text style={styles.short}>
                  {t("sell.shortBy", { amount: formatMAD(totalCents - tenderedCents) })}
                </Text>
              ) : (
                <View style={styles.changeBox}>
                  <Text style={styles.changeLabel}>{t("sell.change")}</Text>
                  <Text style={styles.changeValue}>{formatMAD(change)}</Text>
                </View>
              )}
            </View>
          )}

          {method === "credit" && (
            <View style={styles.block}>
              <Text style={styles.label}>{t("sell.whoPaysLater")}</Text>
              <View style={styles.customers}>
                {customers.map((customer) => (
                  <Pressable
                    key={customer.id}
                    style={[styles.chip, customerId === customer.id && styles.chipActive]}
                    onPress={() => setCustomerId(customer.id)}
                  >
                    <Text
                      style={[styles.chipText, customerId === customer.id && styles.chipTextActive]}
                    >
                      {customer.name}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <View style={styles.newCustomerRow}>
                <TextInput
                  style={[styles.input, styles.flex]}
                  value={newCustomer}
                  onChangeText={setNewCustomer}
                  placeholder={t("sell.newCustomerName")}
                />
                <Pressable style={styles.addCustomer} onPress={handleCreateCustomer}>
                  <Text style={styles.addCustomerText}>{t("common.add")}</Text>
                </Pressable>
              </View>
            </View>
          )}

          {error && <Text style={styles.error}>{error}</Text>}

          <BigButton
            label={saving ? t("common.saving") : t("sell.completeSale")}
            variant="pay"
            onPress={() => onConfirm(method, customerId)}
            disabled={saving || needsCustomer || short}
          />
          <BigButton label={t("common.back")} variant="secondary" onPress={onClose} />
        </ScrollView>
      </View>
    </Modal>
  );
}

// Note amounts a customer is likely to hand over for this total.
function quickAmounts(totalCents: number): number[] {
  const notes = [2000, 5000, 10000, 20000];
  const options = notes.filter((note) => note > totalCents);
  return [totalCents, ...options].slice(0, 4);
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "92%",
  },
  sheetContent: { padding: 20, gap: 14 },
  total: { fontSize: 34, fontWeight: "800", textAlign: "center" },
  methods: { flexDirection: "row", gap: 8 },
  method: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: radius.control,
    backgroundColor: colors.divider,
    alignItems: "center",
  },
  methodActive: { backgroundColor: colors.brand700 },
  methodText: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.ink700,
    textTransform: "capitalize",
  },
  methodTextActive: { color: colors.white },
  block: { gap: 10 },
  label: { fontSize: 14, fontWeight: "600", color: colors.ink700 },
  input: {
    minHeight: 56,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.ink400,
    paddingHorizontal: 16,
    fontSize: 20,
  },
  flex: { flex: 1 },
  quickRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  quick: {
    minHeight: 48,
    justifyContent: "center",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: radius.control,
    backgroundColor: colors.brand100,
  },
  quickText: { fontSize: 15, fontWeight: "600", color: colors.brand700 },
  changeBox: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: colors.brand50,
    borderRadius: radius.control,
    padding: 16,
  },
  changeLabel: { fontSize: 16, fontWeight: "600" },
  changeValue: { fontSize: 26, fontWeight: "800", color: colors.success700 },
  short: { color: colors.danger600, fontSize: 16, fontWeight: "600" },
  customers: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    minHeight: 48,
    justifyContent: "center",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    backgroundColor: colors.divider,
  },
  chipActive: { backgroundColor: colors.brand700 },
  chipText: { fontSize: 14, color: colors.ink700 },
  chipTextActive: { color: colors.white, fontWeight: "600" },
  newCustomerRow: { flexDirection: "row", gap: 8 },
  addCustomer: {
    paddingHorizontal: 20,
    borderRadius: radius.control,
    backgroundColor: colors.brand700,
    alignItems: "center",
    justifyContent: "center",
  },
  addCustomerText: { color: colors.white, fontWeight: "700", fontSize: 15 },
  error: { color: colors.danger600, fontSize: 14 },
});
