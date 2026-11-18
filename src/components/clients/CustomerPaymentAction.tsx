import * as Crypto from "expo-crypto";
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";

import { BigButton } from "@/src/components/BigButton";
import { InlineError } from "@/src/components/ui/InlineError";
import { errorKeyOr } from "@/src/lib/errors/userMessage";
import { formatMAD } from "@/src/lib/money";
import { centsToInputText, checkPaymentAmount } from "@/src/lib/sales/creditLedger";
import { isolateLtr } from "@/src/lib/text/bidi";
import { Text } from "@/src/theme/Text";
import { colors, radius, touch } from "@/src/theme/tokens";

type Props = {
  customerId: string;
  // What the customer owes now (always above zero where this is shown).
  balanceCents: number;
  // Records the payment: the caller passes it on to record_customer_payment.
  onRecord: (paymentId: string, amountCents: number) => Promise<void>;
  // After a recorded payment (reload the balance and history).
  onRecorded: () => void;
};

// The payment box shared by the clients list and a customer's history.
// Payment idempotency lives here (the money path): `paymentId` is ONE id per
// payment being entered, reused if the cashier presses again after a network
// failure (the server records it once), and cleared on success, cancel,
// switching customer, or any change of the amount (typed or "Pay in full").
export function CustomerPaymentAction({ customerId, balanceCents, onRecord, onRecorded }: Props) {
  const { t } = useTranslation();
  const paymentId = useRef<string | null>(null);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);
  // A translation key (see errorKeyOr), never the server's text.
  const [error, setError] = useState<string | null>(null);

  // A different customer is a different payment.
  useEffect(() => {
    paymentId.current = null;
    setOpen(false);
    setAmount("");
    setError(null);
  }, [customerId]);

  const close = () => {
    paymentId.current = null;
    setOpen(false);
    setAmount("");
    setError(null);
  };

  const changeAmount = (value: string) => {
    paymentId.current = null;
    setError(null);
    setAmount(value);
  };

  const check = checkPaymentAmount(amount, balanceCents);

  const record = async () => {
    if (!check.ok || saving) return;
    setSaving(true);
    setError(null);
    try {
      paymentId.current ??= Crypto.randomUUID();
      await onRecord(paymentId.current, check.cents);
      paymentId.current = null;
      setOpen(false);
      setAmount("");
      onRecorded();
    } catch (payError) {
      setError(errorKeyOr(payError, "credit.payError"));
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <Pressable
        accessibilityRole="button"
        style={styles.payButton}
        onPress={() => {
          paymentId.current = null;
          setOpen(true);
        }}
      >
        <Text style={styles.payButtonText}>{t("credit.recordPaymentButton")}</Text>
      </Pressable>
    );
  }

  const validation =
    !check.ok && check.reason === "over"
      ? t("credit.amountOver", { balance: isolateLtr(formatMAD(balanceCents)) })
      : !check.ok && check.reason === "invalid"
        ? t("credit.amountInvalid")
        : null;

  return (
    <View style={styles.payBox}>
      <TextInput
        style={styles.input}
        value={amount}
        onChangeText={changeAmount}
        keyboardType="decimal-pad"
        placeholder={t("credit.amountReceived")}
        accessibilityLabel={t("credit.amountReceived")}
        placeholderTextColor={colors.ink600}
        autoFocus
      />
      <Pressable
        accessibilityRole="button"
        style={styles.fullButton}
        onPress={() => changeAmount(centsToInputText(balanceCents))}
      >
        <Text style={styles.fullButtonText}>
          {`${t("credit.payInFull")} · ${isolateLtr(formatMAD(balanceCents))}`}
        </Text>
      </Pressable>
      {validation ? <Text style={styles.error}>{validation}</Text> : null}
      {error ? <InlineError reasonKey={error} /> : null}
      <BigButton
        label={saving ? t("credit.recordingPayment") : t("credit.recordPayment")}
        onPress={record}
        disabled={saving || !check.ok}
      />
      <BigButton label={t("credit.cancelPayment")} variant="secondary" onPress={close} />
    </View>
  );
}

const styles = StyleSheet.create({
  payButton: {
    minHeight: touch.min,
    justifyContent: "center",
    paddingVertical: 12,
    borderRadius: radius.control,
    backgroundColor: colors.success100,
    alignItems: "center",
  },
  fullButton: {
    minHeight: touch.min,
    justifyContent: "center",
    paddingVertical: 12,
    borderRadius: radius.control,
    backgroundColor: colors.brand100,
    alignItems: "center",
  },
  payButtonText: { color: colors.success700, fontWeight: "700", fontSize: 15 },
  fullButtonText: { color: colors.brand700, fontWeight: "700", fontSize: 15 },
  payBox: { gap: 10 },
  input: {
    minHeight: 52,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    color: colors.ink900,
    paddingHorizontal: 16,
    fontSize: 17,
  },
  error: { color: colors.danger600, fontSize: 14 },
});
