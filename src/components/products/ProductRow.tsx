import { memo } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { formatMAD, formatMargin, marginPercent } from "@/src/lib/money";
import type { Product } from "@/src/lib/products/queries";
import { appDirection, isolateBidi } from "@/src/lib/text/bidi";
import { colors } from "@/src/theme/tokens";
import { Text } from "@/src/theme/Text";

export const PRODUCT_ROW_HEIGHT = 92;

type Props = {
  product: Product;
  showCost: boolean;
  onPress?: () => void;
};

function ProductRowComponent({ product, showCost, onPress }: Props) {
  const { i18n } = useTranslation();
  // A product name must not flip its own row based on its script -- see
  // src/lib/text/bidi.ts.
  const dir = appDirection(i18n.language);
  const textAlign = dir === "rtl" ? "right" : "left";
  const cost = showCost ? product.current_cost_cents : null;
  // Cost 0 means the product has never been received, not that it is free.
  const hasCost = cost !== null && cost > 0;
  const unitProfit = hasCost ? product.selling_price_cents - cost : null;
  const margin = hasCost ? marginPercent(product.selling_price_cents, cost) : null;
  const belowCost = unitProfit !== null && unitProfit < 0;

  return (
    <Pressable
      style={({ pressed }) => [
        styles.row,
        { direction: dir },
        pressed && onPress ? styles.pressed : null,
      ]}
      onPress={onPress}
    >
      <View style={styles.main}>
        <Text style={[styles.name, { textAlign }]} numberOfLines={1}>
          {isolateBidi(product.name)}
        </Text>
        <Text style={[styles.meta, { textAlign }]} numberOfLines={1}>
          {product.barcode ?? "no barcode"} · {product.stock_quantity} {product.unit}
          {product.is_low_stock ? " · LOW" : ""}
          {product.active ? "" : " · inactive"}
        </Text>
      </View>

      <View style={styles.right}>
        <Text style={styles.price}>{formatMAD(product.selling_price_cents)}</Text>

        {showCost &&
          (hasCost ? (
            <>
              <Text style={styles.cost}>buy {formatMAD(cost)}</Text>
              <Text style={[styles.profit, belowCost && styles.profitNegative]}>
                {(unitProfit as number) >= 0 ? "+" : ""}
                {formatMAD(unitProfit as number)} · {formatMargin(margin)}
              </Text>
            </>
          ) : (
            <Text style={styles.cost}>no cost yet</Text>
          ))}
      </View>
    </Pressable>
  );
}

export const ProductRow = memo(ProductRowComponent);

const styles = StyleSheet.create({
  row: {
    height: PRODUCT_ROW_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    gap: 12,
  },
  pressed: { backgroundColor: colors.sunken },
  main: { flex: 1, gap: 4 },
  name: { fontSize: 16, fontWeight: "600" },
  meta: { fontSize: 13, color: colors.ink600 },
  right: { alignItems: "flex-end", gap: 2 },
  price: { fontSize: 17, fontWeight: "700" },
  cost: { fontSize: 13, color: colors.ink600 },
  profit: { fontSize: 14, color: colors.success700, fontWeight: "700" },
  profitNegative: { color: colors.danger600 },
});
