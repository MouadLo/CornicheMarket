import { useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";

import { centsToDisplay, formatMAD, parseMoneyToCents, parseQuantity } from "@/src/lib/money";
import { unitLabel } from "@/src/lib/products/unitLabel";
import { isLineDiscountValid, lineTotal, type CartLine } from "@/src/lib/sales/totals";
import { isolateBidi } from "@/src/lib/text/bidi";
import { colors, radius } from "@/src/theme/tokens";
import { Text } from "@/src/theme/Text";

type Props = {
  line: CartLine;
  onChange: (next: CartLine) => void;
  onRemove: () => void;
};

export function CartLineRow({ line, onChange, onRemove }: Props) {
  const { t } = useTranslation();
  const weighted = line.unit === "kg";
  const discountTooHigh = !isLineDiscountValid(
    line.quantity,
    line.unit_price_cents,
    line.discount_cents
  );

  const step = (delta: number) => {
    const next = Math.max(0, Number((line.quantity + delta).toFixed(3)));
    if (next === 0) {
      onRemove();
      return;
    }
    onChange({ ...line, quantity: next });
  };

  // The line is one compact row (UX C4). Discount and remove sit behind a tap
  // on the name (C5); they open by themselves when something needs fixing.
  const [expanded, setExpanded] = useState(false);
  const needsAttention = discountTooHigh || (weighted && !(line.quantity > 0));
  const open = expanded || needsAttention;

  return (
    <View style={styles.row}>
      <View style={styles.main}>
        <Pressable
          style={styles.info}
          onPress={() => setExpanded((value) => !value)}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
        >
          <Text style={styles.name} numberOfLines={1}>
            {isolateBidi(line.name)}
          </Text>
          <Text style={styles.unitPrice} numberOfLines={1}>
            {formatMAD(line.unit_price_cents)} / {unitLabel(line.unit, 1, t)}
            {line.discount_cents > 0 ? ` · −${formatMAD(line.discount_cents)}` : ""}
          </Text>
        </Pressable>

        {weighted ? (
          <WeightField
            quantity={line.quantity}
            onQuantity={(quantity) => onChange({ ...line, quantity })}
          />
        ) : (
          <View style={styles.stepper}>
            <Pressable
              accessibilityRole="button"
              style={styles.stepButton}
              onPress={() => step(-1)}
            >
              <Text style={styles.stepText}>−</Text>
            </Pressable>
            <Text style={styles.quantity}>{line.quantity}</Text>
            <Pressable accessibilityRole="button" style={styles.stepButton} onPress={() => step(1)}>
              <Text style={styles.stepText}>+</Text>
            </Pressable>
          </View>
        )}

        <Text style={styles.total}>{formatMAD(lineTotal(line))}</Text>
      </View>

      {open && (
        <View style={styles.details}>
          <View style={styles.discountBox}>
            <Text style={styles.label}>{t("sell.discount")}</Text>
            <DiscountField
              cents={line.discount_cents}
              invalid={discountTooHigh}
              label={t("sell.discount")}
              onCents={(discount_cents) => onChange({ ...line, discount_cents })}
            />
          </View>
          <Pressable accessibilityRole="button" onPress={onRemove} style={styles.removeButton}>
            <Text style={styles.remove}>{t("sell.remove")}</Text>
          </Pressable>
        </View>
      )}

      {discountTooHigh && <Text style={styles.discountError}>{t("sell.lineDiscountTooHigh")}</Text>}
      {weighted && !(line.quantity > 0) && (
        <Text style={styles.discountError}>{t("sell.weightRequired")}</Text>
      )}
    </View>
  );
}

// The discount field keeps what the cashier typed, for the same reason as the
// weight field below: formatting the parsed value on every keystroke turned
// "0.5" into "5.00" and "12" into "1.00" (the first digit was parsed and
// reformatted before the second arrived), recording ten times the discount
// meant. The field shows the typed text while it still means the current
// discount, and the formatted value when the discount changed from outside.
function DiscountField({
  cents,
  invalid,
  label,
  onCents,
}: {
  cents: number;
  invalid: boolean;
  label: string;
  onCents: (cents: number) => void;
}) {
  const [text, setText] = useState(cents ? centsToDisplay(cents) : "");
  const typedCents = text.trim() === "" ? 0 : (parseMoneyToCents(text) ?? 0);
  const shown = typedCents === cents ? text : cents ? centsToDisplay(cents) : "";
  return (
    <TextInput
      style={[styles.discountInput, invalid && styles.discountInputInvalid]}
      value={shown}
      onChangeText={(value) => {
        setText(value);
        onCents(value.trim() === "" ? 0 : (parseMoneyToCents(value) ?? 0));
      }}
      keyboardType="decimal-pad"
      placeholder="0.00"
      accessibilityLabel={label}
    />
  );
}

// The field shows what the cashier typed, not String(quantity): the parsed
// value of "0." is 0, which would be shown back as "0" and swallow the ".".
// If the quantity is changed from outside (a second weighing added to the
// line), the typed text no longer matches it and the field shows the new
// quantity instead.
function WeightField({
  quantity,
  onQuantity,
}: {
  quantity: number;
  onQuantity: (quantity: number) => void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState(String(quantity));
  const shown = (parseQuantity(text) ?? 0) === quantity ? text : String(quantity);

  return (
    <View style={styles.weightBox}>
      <TextInput
        style={[styles.weightInput, !(quantity > 0) && styles.weightInputInvalid]}
        value={shown}
        onChangeText={(value) => {
          setText(value);
          onQuantity(parseQuantity(value) ?? 0);
        }}
        keyboardType="decimal-pad"
        selectTextOnFocus
        accessibilityLabel={unitLabel("kg", quantity, t)}
      />
      <Text style={styles.label}>{unitLabel("kg", quantity, t)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    gap: 4,
    backgroundColor: colors.surface,
  },
  main: { flexDirection: "row", alignItems: "center", gap: 10 },
  info: { flex: 1, minHeight: 48, justifyContent: "center", minWidth: 70 },
  details: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" },
  name: { fontSize: 16, fontWeight: "600" },
  total: { fontSize: 16, fontWeight: "700", minWidth: 72, textAlign: "right" },
  stepper: { flexDirection: "row", alignItems: "center", gap: 4 },
  stepButton: {
    width: 48,
    height: 48,
    borderRadius: radius.pill,
    backgroundColor: colors.divider,
    alignItems: "center",
    justifyContent: "center",
  },
  stepText: { fontSize: 24, fontWeight: "700", color: colors.ink900 },
  quantity: { fontSize: 18, fontWeight: "700", minWidth: 28, textAlign: "center" },
  weightBox: { flexDirection: "row", alignItems: "center", gap: 6 },
  weightInput: {
    minHeight: 48,
    width: 72,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.ink400,
    paddingHorizontal: 12,
    fontSize: 16,
  },
  discountBox: { gap: 4 },
  discountInput: {
    minHeight: 48,
    minWidth: 92,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.ink400,
    paddingHorizontal: 12,
    fontSize: 16,
  },
  label: { fontSize: 15, color: colors.ink600 },
  removeButton: { minHeight: 48, minWidth: 48, alignItems: "center", justifyContent: "center" },
  remove: { color: colors.danger600, fontWeight: "600", fontSize: 14 },
  unitPrice: { fontSize: 15, color: colors.ink600 },
  discountInputInvalid: { borderColor: colors.danger600 },
  weightInputInvalid: { borderColor: colors.danger600 },
  discountError: { color: colors.danger600, fontSize: 15 },
});
