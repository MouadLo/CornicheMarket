import { useEffect, useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";

import { BigButton } from "@/src/components/BigButton";
import { Chip } from "@/src/components/ui/Chip";
import { InlineError } from "@/src/components/ui/InlineError";
import { errorKeyOr } from "@/src/lib/errors/userMessage";
import { centsToDisplay, formatMAD, parseMoneyToCents } from "@/src/lib/money";
import { isolateLtr } from "@/src/lib/text/bidi";
import { Text } from "@/src/theme/Text";
import { colors, radius } from "@/src/theme/tokens";

type Mode = "store" | "custom" | "none";

type Props = {
  customerId: string;
  // The customer's own limit: null = the store default applies, 0 = no credit.
  overrideCents: number | null;
  // The limit that applies to them now (own, else the store's).
  effectiveCents: number;
  storeDefaultCents: number;
  // Saves the choice (null = the store default). Owner only: the database
  // refuses anyone else, and the screen only renders this editor for the owner.
  onSave: (cents: number | null) => Promise<void>;
  onSaved: () => void;
};

function modeOf(overrideCents: number | null): Mode {
  if (overrideCents === null) return "store";
  return overrideCents === 0 ? "none" : "custom";
}

// The owner's editor for one customer's debt limit: the store default, a custom
// amount, or no credit at all.
export function CreditLimitEditor({
  customerId,
  overrideCents,
  effectiveCents,
  storeDefaultCents,
  onSave,
  onSaved,
}: Props) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>(modeOf(overrideCents));
  const [amount, setAmount] = useState(overrideCents ? centsToDisplay(overrideCents) : "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Start from what is saved whenever the customer or the saved value changes.
  useEffect(() => {
    setMode(modeOf(overrideCents));
    setAmount(overrideCents ? centsToDisplay(overrideCents) : "");
    setError(null);
  }, [customerId, overrideCents]);

  const save = async () => {
    setMessage(null);
    let cents: number | null = null;
    if (mode === "none") cents = 0;
    if (mode === "custom") {
      cents = parseMoneyToCents(amount);
      if (cents === null || cents < 0) {
        setError("credit.limitInvalid");
        return;
      }
    }
    setError(null);
    setSaving(true);
    try {
      await onSave(cents);
      setMessage(t("credit.limitSaved"));
      onSaved();
    } catch (failure) {
      setError(errorKeyOr(failure, "credit.limitError"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.box}>
      <Text style={styles.title}>{t("credit.limitTitle")}</Text>
      <Text style={styles.meta}>
        {t("credit.limitCurrent", { amount: isolateLtr(formatMAD(effectiveCents)) })}
      </Text>
      <View style={styles.options}>
        <Chip
          label={t("credit.limitStoreOption", { amount: isolateLtr(formatMAD(storeDefaultCents)) })}
          selected={mode === "store"}
          onPress={() => setMode("store")}
        />
        <Chip
          label={t("credit.limitCustomOption")}
          selected={mode === "custom"}
          onPress={() => setMode("custom")}
        />
        <Chip
          label={t("credit.limitNoneOption")}
          selected={mode === "none"}
          onPress={() => setMode("none")}
        />
      </View>
      {mode === "custom" ? (
        <TextInput
          style={styles.input}
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
          placeholder="500.00"
          accessibilityLabel={t("credit.limitAmount")}
        />
      ) : null}
      {error ? <InlineError reasonKey={error} /> : null}
      {message ? <Text style={styles.success}>{message}</Text> : null}
      <BigButton label={t("credit.limitSave")} onPress={save} disabled={saving} />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { backgroundColor: colors.surface, borderRadius: radius.panel, padding: 16, gap: 8 },
  title: { fontSize: 16, fontWeight: "700", color: colors.ink900 },
  meta: { fontSize: 14, color: colors.ink600 },
  options: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  input: {
    minHeight: 56,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.ink400,
    paddingHorizontal: 16,
    fontSize: 20,
  },
  success: { color: colors.success700, fontSize: 15 },
});
