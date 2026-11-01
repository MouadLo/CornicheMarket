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

  return (
    <View style={styles.row}>
      <View style={styles.header}>
        <Text style={styles.name} numberOfLines={1}>
          {isolateBidi(line.name)}
        </Text>
        <Text style={styles.total}>{formatMAD(lineTotal(line))}</Text>
      </View>

      <View style={styles.controls}>
        {weighted ? (
          <WeightField
            quantity={line.quantity}
            onQuantity={(quantity) => onChange({ ...line, quantity })}
          />
        ) : (
          <View style={styles.stepper}>
            <Pressable style={styles.stepButton} onPress={() => step(-1)}>
              <Text style={styles.stepText}>−</Text>
            </Pressable>
            <Text style={styles.quantity}>{line.quantity}</Text>
            <Pressable style={styles.stepButton} onPress={() => step(1)}>
              <Text style={styles.stepText}>+</Text>
            </Pressable>
          </View>
        )}

        <View style={styles.discountBox}>
          <Text style={styles.label}>{t("sell.discount")}</Text>
          <TextInput
            style={[styles.discountInput, discountTooHigh && styles.discountInputInvalid]}
            value={line.discount_cents ? centsToDisplay(line.discount_cents) : ""}
            onChangeText={(value) =>
              onChange({ ...line, discount_cents: value ? (parseMoneyToCents(value) ?? 0) : 0 })
            }
            keyboardType="decimal-pad"
            placeholder="0.00"
          />
        </View>

        <Pressable onPress={onRemove} style={styles.removeButton}>
          <Text style={styles.remove}>{t("sell.remove")}</Text>
        </Pressable>
      </View>

      {discountTooHigh && <Text style={styles.discountError}>{t("sell.lineDiscountTooHigh")}</Text>}
      {weighted && !(line.quantity > 0) && (
        <Text style={styles.discountError}>{t("sell.weightRequired")}</Text>
      )}

      <Text style={styles.unitPrice}>
        {formatMAD(line.unit_price_cents)} / {unitLabel(line.unit, 1, t)}
      </Text>
    </View>
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
      <Text style={styles.label}>{unitLabel("kg", quantity, t)}</Text>
      <TextInput
        style={[styles.weightInput, !(quantity > 0) && styles.weightInputInvalid]}
        value={shown}
        onChangeText={(value) => {
          setText(value);
          onQuantity(parseQuantity(value) ?? 0);
        }}
        keyboardType="decimal-pad"
        selectTextOnFocus
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    gap: 8,
  },
  header: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  name: { fontSize: 16, fontWeight: "600", flex: 1 },
  total: { fontSize: 16, fontWeight: "700" },
  controls: { flexDirection: "row", alignItems: "center", gap: 14, flexWrap: "wrap" },
  stepper: { flexDirection: "row", alignItems: "center", gap: 10 },
  stepButton: {
    width: 48,
    height: 48,
    borderRadius: radius.pill,
    backgroundColor: colors.divider,
    alignItems: "center",
    justifyContent: "center",
  },
  stepText: { fontSize: 24, fontWeight: "700", color: colors.ink900 },
  quantity: { fontSize: 18, fontWeight: "700", minWidth: 32, textAlign: "center" },
  weightBox: { gap: 4 },
  weightInput: {
    minHeight: 48,
    minWidth: 92,
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
  label: { fontSize: 12, color: colors.ink600 },
  removeButton: { minHeight: 48, minWidth: 48, alignItems: "center", justifyContent: "center" },
  remove: { color: colors.danger600, fontWeight: "600", fontSize: 14 },
  unitPrice: { fontSize: 13, color: colors.ink600 },
  discountInputInvalid: { borderColor: colors.danger600 },
  weightInputInvalid: { borderColor: colors.danger600 },
  discountError: { color: colors.danger600, fontSize: 12 },
});
