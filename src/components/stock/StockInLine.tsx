import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";

import { centsToDisplay, formatMAD, formatMargin, marginPercent, parseMoneyToCents, parseQuantity } from "@/src/lib/money";
import type { Product } from "@/src/lib/products/queries";
import {
  isSignificantPriceChange,
  priceChangePercent,
  suggestSellingPrice,
} from "@/src/lib/stock/pricing";

export type LineState = {
  product: Product;
  quantity: string;
  unitCost: string;
  lastCostCents: number | null;
  newSellingPriceCents: number | null;
  expiryDate: string;
};

type Props = {
  line: LineState;
  onChange: (next: LineState) => void;
  onRemove: () => void;
};

export function StockInLine({ line, onChange, onRemove }: Props) {
  const { t } = useTranslation();
  const { product, lastCostCents } = line;
  const costCents = parseMoneyToCents(line.unitCost);
  const quantity = parseQuantity(line.quantity);

  const lineTotal =
    costCents !== null && quantity !== null ? Math.round(costCents * quantity) : null;

  const flagged =
    costCents !== null && lastCostCents !== null && isSignificantPriceChange(lastCostCents, costCents);
  const change =
    costCents !== null && lastCostCents !== null ? priceChangePercent(lastCostCents, costCents) : null;

  const suggested =
    costCents !== null && lastCostCents !== null
      ? suggestSellingPrice(product.selling_price_cents, lastCostCents, costCents)
      : null;
  const suggestionWorthShowing =
    flagged && suggested !== null && suggested !== product.selling_price_cents;

  const effectiveSellingPrice = line.newSellingPriceCents ?? product.selling_price_cents;

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.name} numberOfLines={1}>
          {product.name}
        </Text>
        <Pressable onPress={onRemove} hitSlop={8}>
          <Text style={styles.remove}>Remove</Text>
        </Pressable>
      </View>

      <Text style={styles.meta}>
        stock {product.stock_quantity} {product.unit} · sells at {formatMAD(effectiveSellingPrice)}
        {line.newSellingPriceCents !== null ? " (new)" : ""}
      </Text>

      <View style={styles.inputs}>
        <View style={styles.inputGroup}>
          <Text style={styles.label}>Quantity</Text>
          <TextInput
            style={styles.input}
            value={line.quantity}
            onChangeText={(value) => onChange({ ...line, quantity: value })}
            keyboardType="decimal-pad"
            placeholder="0"
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Buying price</Text>
          <TextInput
            style={styles.input}
            value={line.unitCost}
            onChangeText={(value) => onChange({ ...line, unitCost: value })}
            keyboardType="decimal-pad"
            placeholder="0.00"
          />
        </View>
      </View>

      <View style={styles.inputGroup}>
        <Text style={styles.label}>Expiry date (optional)</Text>
        <TextInput
          style={styles.input}
          value={line.expiryDate}
          onChangeText={(value) => onChange({ ...line, expiryDate: value })}
          placeholder="YYYY-MM-DD"
          autoCapitalize="none"
        />
      </View>

      <Text style={styles.lastPrice}>
        {lastCostCents === null
          ? t('stockIn.firstTimeBuying')
          : `Last paid ${formatMAD(lastCostCents)}`}
        {lineTotal !== null ? ` · line total ${formatMAD(lineTotal)}` : ""}
      </Text>

      {flagged && change !== null && (
        <View style={styles.alert}>
          <Text style={styles.alertTitle}>
            Buying price {change > 0 ? "up" : "down"} {Math.abs(change).toFixed(1)}% vs last
            delivery
          </Text>

          {suggestionWorthShowing && (
            <>
              <Text style={styles.alertBody}>
                Selling at {formatMAD(product.selling_price_cents)} would now give{" "}
                {formatMargin(marginPercent(product.selling_price_cents, costCents as number))}{" "}
                instead of {formatMargin(marginPercent(product.selling_price_cents, lastCostCents as number))}.
              </Text>
              <View style={styles.suggestionRow}>
                <Text style={styles.alertBody}>
                  Keep the old margin: {formatMAD(suggested as number)}
                </Text>
                {line.newSellingPriceCents === null ? (
                  <Pressable
                    style={styles.applyButton}
                    onPress={() => onChange({ ...line, newSellingPriceCents: suggested })}
                  >
                    <Text style={styles.applyButtonText}>
                      Use {centsToDisplay(suggested as number)}
                    </Text>
                  </Pressable>
                ) : (
                  <Pressable
                    style={styles.undoButton}
                    onPress={() => onChange({ ...line, newSellingPriceCents: null })}
                  >
                    <Text style={styles.undoButtonText}>Undo</Text>
                  </Pressable>
                )}
              </View>
            </>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderColor: "#e4e4e4",
    borderRadius: 12,
    padding: 14,
    gap: 8,
    backgroundColor: "#fff",
  },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 },
  name: { fontSize: 16, fontWeight: "700", flex: 1 },
  remove: { color: "#b3261e", fontSize: 14, fontWeight: "600" },
  meta: { fontSize: 13, color: "#666" },
  inputs: { flexDirection: "row", gap: 12 },
  inputGroup: { flex: 1, gap: 6 },
  label: { fontSize: 13, fontWeight: "600", color: "#444" },
  input: {
    minHeight: 52,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#ccc",
    paddingHorizontal: 14,
    fontSize: 16,
  },
  lastPrice: { fontSize: 13, color: "#555" },
  alert: { backgroundColor: "#fff6e5", borderRadius: 10, padding: 12, gap: 6 },
  alertTitle: { fontWeight: "700", color: "#8a5a00" },
  alertBody: { fontSize: 14, color: "#5f4100", flexShrink: 1 },
  suggestionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    flexWrap: "wrap",
  },
  applyButton: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: "#1d7a46",
  },
  applyButtonText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  undoButton: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: "#e8e8e8",
  },
  undoButtonText: { color: "#333", fontWeight: "600", fontSize: 14 },
});
