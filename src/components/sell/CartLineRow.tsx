import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";

import { centsToDisplay, formatMAD, parseMoneyToCents, parseQuantity } from "@/src/lib/money";
import { isLineDiscountValid, lineTotal, type CartLine } from "@/src/lib/sales/totals";

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
          {line.name}
        </Text>
        <Text style={styles.total}>{formatMAD(lineTotal(line))}</Text>
      </View>

      <View style={styles.controls}>
        {weighted ? (
          <View style={styles.weightBox}>
            <Text style={styles.label}>kg</Text>
            <TextInput
              style={styles.weightInput}
              value={String(line.quantity)}
              onChangeText={(value) => onChange({ ...line, quantity: parseQuantity(value) ?? 0 })}
              keyboardType="decimal-pad"
              selectTextOnFocus
            />
          </View>
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

        <Pressable onPress={onRemove} hitSlop={8}>
          <Text style={styles.remove}>{t("sell.remove")}</Text>
        </Pressable>
      </View>

      {discountTooHigh && <Text style={styles.discountError}>{t("sell.lineDiscountTooHigh")}</Text>}

      <Text style={styles.unitPrice}>
        {formatMAD(line.unit_price_cents)} / {line.unit}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
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
    borderRadius: 24,
    backgroundColor: "#eee",
    alignItems: "center",
    justifyContent: "center",
  },
  stepText: { fontSize: 24, fontWeight: "700", color: "#222" },
  quantity: { fontSize: 18, fontWeight: "700", minWidth: 32, textAlign: "center" },
  weightBox: { gap: 4 },
  weightInput: {
    minHeight: 48,
    minWidth: 92,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#ccc",
    paddingHorizontal: 12,
    fontSize: 16,
  },
  discountBox: { gap: 4 },
  discountInput: {
    minHeight: 48,
    minWidth: 92,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#ccc",
    paddingHorizontal: 12,
    fontSize: 16,
  },
  label: { fontSize: 12, color: "#666" },
  remove: { color: "#b3261e", fontWeight: "600", fontSize: 14 },
  unitPrice: { fontSize: 13, color: "#666" },
  discountInputInvalid: { borderColor: "#b3261e" },
  discountError: { color: "#b3261e", fontSize: 12 },
});
