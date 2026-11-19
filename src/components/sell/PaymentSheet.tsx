import { useEffect, useRef, useState } from "react";
import { Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";

import { BigButton } from "@/src/components/BigButton";
import { centsToDisplay, formatMAD, parseMoneyToCents } from "@/src/lib/money";
import { filterCustomers, findCustomerByName, pressCashKey } from "@/src/lib/sales/cashEntry";
import { paymentMethodKey } from "@/src/lib/sales/paymentMethod";
import { changeDue, isShortPayment } from "@/src/lib/sales/totals";
import { isScannerBurst, keyFromKeyboardEvent, type WeightKey } from "@/src/lib/sales/weightEntry";
import type { Customer, PaymentMethod } from "@/src/lib/sales/queries";
import { isolateBidi, isolateLtr } from "@/src/lib/text/bidi";
import { colors, radius, touch } from "@/src/theme/tokens";
import { Banner } from "@/src/components/ui/Banner";
import { Chip } from "@/src/components/ui/Chip";
import { Text } from "@/src/theme/Text";

type Props = {
  visible: boolean;
  totalCents: number;
  customers: Customer[];
  saving: boolean;
  error: string | null;
  onClose: () => void;
  // change: what to hand back (cash only; 0 for an exact amount or any other method).
  onConfirm: (method: PaymentMethod, customerId: string | null, change: number) => void;
  onCreateCustomer: (name: string) => Promise<Customer | null>;
};

const METHODS: PaymentMethod[] = ["cash", "card", "credit"];

// Past this many customers the list gets a search box.
const SEARCH_FROM = 6;

const KEY_ROWS: WeightKey[][] = [
  ["7", "8", "9"],
  ["4", "5", "6"],
  ["1", "2", "3"],
  [".", "0", "back"],
];

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
  const [search, setSearch] = useState("");
  const [cardDeclined, setCardDeclined] = useState(false);

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
      setSearch("");
      setCardDeclined(false);
    }
  }

  const tenderedCents = parseMoneyToCents(tendered) ?? 0;
  const short = method === "cash" && tendered !== "" && isShortPayment(tenderedCents, totalCents);
  const change = changeDue(tenderedCents, totalCents);
  const chosen = customers.find((customer) => customer.id === customerId) ?? null;
  const needsCustomer = method === "credit" && !chosen;

  // Physical keyboard on web: digits, the decimal point and Backspace fill the
  // cash amount. Enter is left alone (a scanner ends with it), and keys that
  // arrive scanner-fast are ignored.
  const active = visible && method === "cash";
  const lastKeyAt = useRef<number | null>(null);
  useEffect(() => {
    if (!active || Platform.OS !== "web" || typeof document === "undefined") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const key = keyFromKeyboardEvent(event.key);
      if (key === null || key === "enter" || key === "escape") return;
      const scanned =
        key !== "back" && (event.repeat || isScannerBurst(lastKeyAt.current, event.timeStamp));
      lastKeyAt.current = event.timeStamp;
      event.preventDefault();
      if (!scanned) setTendered((current) => pressCashKey(current, key));
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [active]);

  const handleCreateCustomer = async () => {
    const name = newCustomer.trim();
    if (!name) return;
    // Typing someone who already exists selects them: a second record would
    // split their debt in two.
    const existing = findCustomerByName(customers, name);
    if (existing) {
      setCustomerId(existing.id);
      setNewCustomer("");
      return;
    }
    const created = await onCreateCustomer(name);
    if (created) {
      setCustomerId(created.id);
      setNewCustomer("");
    }
  };

  const shown = filterCustomers(customers, search);

  const confirmLabel = saving
    ? t("common.saving")
    : method === "credit" && chosen
      ? t("sell.putOnCredit", { amount: formatMAD(totalCents), name: isolateBidi(chosen.name) })
      : t("sell.completeSale");

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.sheetContent}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={styles.total}>{formatMAD(totalCents)}</Text>

            <View style={styles.methods}>
              {METHODS.map((value) => (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: method === value }}
                  key={value}
                  style={[styles.method, method === value && styles.methodActive]}
                  onPress={() => {
                    setMethod(value);
                    setCardDeclined(false);
                  }}
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
                {/* Not a text field: the system keyboard would cover the sheet. */}
                <View style={styles.display}>
                  <Text
                    testID="cash-entry"
                    style={[styles.entry, tendered === "" && styles.entryEmpty]}
                  >
                    {tendered === "" ? "—" : tendered}
                  </Text>
                  <Text style={styles.unit}>DH</Text>
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

                <View style={styles.quickRow}>
                  <Pressable
                    accessibilityRole="button"
                    style={[styles.quick, styles.quickExact]}
                    onPress={() => setTendered(centsToDisplay(totalCents))}
                  >
                    <Text style={[styles.quickText, styles.quickExactText]}>
                      {t("sell.exactAmount")}
                    </Text>
                  </Pressable>
                  {quickAmounts(totalCents).map((amount) => (
                    <Pressable
                      accessibilityRole="button"
                      key={amount}
                      style={styles.quick}
                      onPress={() => setTendered(centsToDisplay(amount))}
                    >
                      <Text style={styles.quickText}>{centsToDisplay(amount)}</Text>
                    </Pressable>
                  ))}
                </View>

                {KEY_ROWS.map((row) => (
                  <View key={row.join("")} style={styles.keyRow}>
                    {row.map((key) => (
                      <Pressable
                        key={key}
                        testID={`cash-key-${key}`}
                        accessibilityRole="button"
                        accessibilityLabel={key === "back" ? t("common.back") : key}
                        style={({ pressed }) => [styles.key, pressed && styles.keyPressed]}
                        onPress={() => setTendered((current) => pressCashKey(current, key))}
                      >
                        <Text style={styles.keyText}>{key === "back" ? "⌫" : key}</Text>
                      </Pressable>
                    ))}
                  </View>
                ))}
              </View>
            )}

            {method === "card" && (
              <View style={styles.block}>
                <Text style={styles.cardInstruction}>
                  {t("sell.cardInstruction", { amount: isolateLtr(formatMAD(totalCents)) })}
                </Text>
              </View>
            )}

            {method === "credit" && (
              <View style={styles.block}>
                <Text style={styles.label}>{t("sell.whoPaysLater")}</Text>
                {customers.length > SEARCH_FROM && (
                  <TextInput
                    style={styles.input}
                    value={search}
                    onChangeText={setSearch}
                    placeholder={t("sell.searchCustomer")}
                    accessibilityLabel={t("sell.searchCustomer")}
                  />
                )}
                <View style={styles.customers}>
                  {shown.map((customer) => {
                    const owed = customer.balance_cents ?? 0;
                    const selected = customerId === customer.id;
                    return (
                      <Chip
                        key={customer.id}
                        label={customer.name}
                        alert={owed > 0 ? t("sell.owes", { amount: formatMAD(owed) }) : undefined}
                        selected={selected}
                        onPress={() => setCustomerId(customer.id)}
                      />
                    );
                  })}
                  {shown.length === 0 && (
                    <Text style={styles.hint}>{t("sell.noCustomerFound")}</Text>
                  )}
                </View>

                <View style={styles.newCustomerRow}>
                  <TextInput
                    style={[styles.input, styles.flex]}
                    value={newCustomer}
                    onChangeText={setNewCustomer}
                    placeholder={t("sell.newCustomerName")}
                    accessibilityLabel={t("sell.newCustomerName")}
                  />
                  <Pressable
                    accessibilityRole="button"
                    style={styles.addCustomer}
                    onPress={handleCreateCustomer}
                  >
                    <Text style={styles.addCustomerText}>{t("common.add")}</Text>
                  </Pressable>
                </View>
              </View>
            )}

            {error && <Text style={styles.error}>{error}</Text>}
          </ScrollView>

          {/* Pinned: Complete sale is always in the same place, whatever the method. */}
          <View style={styles.footer}>
            {needsCustomer && <Text style={styles.hint}>{t("sell.chooseCustomer")}</Text>}
            {method === "card" ? (
              <>
                <View accessibilityLiveRegion="polite">
                  {cardDeclined && <Banner tone="bad" text={t("sell.cardDeclinedMessage")} />}
                </View>
                <BigButton
                  label={saving ? t("common.saving") : t("sell.cardAccepted")}
                  variant="pay"
                  tall
                  onPress={() => onConfirm("card", customerId, 0)}
                  disabled={saving}
                />
                <View style={styles.declineGap}>
                  <BigButton
                    label={t("sell.cardDeclined")}
                    variant="secondary"
                    onPress={() => setCardDeclined(true)}
                    disabled={saving}
                  />
                </View>
              </>
            ) : (
              <BigButton
                label={confirmLabel}
                variant="pay"
                tall
                onPress={() => onConfirm(method, customerId, method === "cash" ? change : 0)}
                disabled={saving || needsCustomer || short}
              />
            )}
            <Pressable style={styles.back} onPress={onClose} accessibilityRole="button">
              <Text style={styles.backText}>{t("common.back")}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// Notes a customer is likely to hand over above this total (the exact amount has its own button).
function quickAmounts(totalCents: number): number[] {
  const notes = [2000, 5000, 10000, 20000];
  return notes.filter((note) => note > totalCents).slice(0, 3);
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  // A centred panel (like the weight keypad), not the full width: the basket
  // stays visible behind it on a wide screen.
  sheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "96%",
    width: "100%",
    maxWidth: 480,
    alignSelf: "center",
  },
  body: { flexShrink: 1 },
  sheetContent: { padding: 20, paddingBottom: 8, gap: 12 },
  total: { fontSize: 34, fontWeight: "800", textAlign: "center" },
  methods: { flexDirection: "row", gap: 8 },
  method: {
    flex: 1,
    minHeight: touch.lg,
    justifyContent: "center",
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
  display: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "baseline",
    gap: 8,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.ink400,
    paddingVertical: 8,
  },
  entry: { fontSize: 40, fontWeight: "800" },
  entryEmpty: { color: colors.ink400 },
  unit: { fontSize: 20, fontWeight: "600", color: colors.ink600 },
  quickRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  quick: {
    flexGrow: 1,
    minHeight: touch.lg,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    borderRadius: radius.control,
    backgroundColor: colors.brand100,
  },
  quickExact: { backgroundColor: colors.brand700 },
  quickExactText: { color: colors.white },
  quickText: { fontSize: 18, fontWeight: "700", color: colors.brand700 },
  keyRow: { flexDirection: "row", gap: 8 },
  key: {
    flex: 1,
    minHeight: touch.lg,
    borderRadius: radius.control,
    backgroundColor: colors.brand100,
    alignItems: "center",
    justifyContent: "center",
  },
  keyPressed: { opacity: 0.7 },
  keyText: { fontSize: 24, fontWeight: "700", color: colors.ink900 },
  changeBox: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: colors.brand50,
    borderRadius: radius.control,
    padding: 14,
  },
  changeLabel: { fontSize: 16, fontWeight: "600" },
  changeValue: { fontSize: 26, fontWeight: "800", color: colors.success700 },
  short: { color: colors.danger600, fontSize: 16, fontWeight: "600" },
  customers: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  newCustomerRow: { flexDirection: "row", gap: 8 },
  addCustomer: {
    paddingHorizontal: 20,
    borderRadius: radius.control,
    backgroundColor: colors.brand700,
    alignItems: "center",
    justifyContent: "center",
  },
  addCustomerText: { color: colors.white, fontWeight: "700", fontSize: 15 },
  error: { color: colors.danger600, fontSize: 15 },
  footer: {
    padding: 20,
    paddingTop: 10,
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  cardInstruction: { fontSize: 17, fontWeight: "600", color: colors.ink900, textAlign: "center" },
  declineGap: { marginTop: 12 },
  hint: { fontSize: 15, color: colors.ink600, textAlign: "center" },
  // Small and apart from Complete sale: a slip must not leave the payment.
  back: { minHeight: touch.min, alignItems: "center", justifyContent: "center", marginTop: 8 },
  backText: { fontSize: 16, fontWeight: "600", color: colors.ink600 },
});
