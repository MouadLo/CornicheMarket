import { memo } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { bonusIsActive } from "@/src/lib/loyalty/bonus";
import { formatMAD, formatMargin, marginPercent } from "@/src/lib/money";
import { ProductPhoto } from "@/src/components/products/ProductPhoto";
import type { Product } from "@/src/lib/products/queries";
import { unitLabel } from "@/src/lib/products/unitLabel";
import { appDirection, isolateBidi, isolateLtr } from "@/src/lib/text/bidi";
import { colors } from "@/src/theme/tokens";
import { Text } from "@/src/theme/Text";

export const PRODUCT_ROW_HEIGHT = 92;

type Props = {
  product: Product;
  showCost: boolean;
  onPress?: () => void;
  /** Soft flash on the row the owner just came back from. */
  highlighted?: boolean;
};

function ProductRowComponent({ product, showCost, onPress, highlighted }: Props) {
  const { t, i18n } = useTranslation();
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

  // Loyalty: not cost data, so cashiers see it too.
  const loyaltyExcluded = product.loyalty_excluded === true;
  const bonusActive = bonusIsActive(product);

  return (
    <Pressable
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.row,
        { direction: dir },
        highlighted ? styles.highlighted : null,
        pressed && onPress ? styles.pressed : null,
      ]}
      onPress={onPress}
    >
      <ProductPhoto path={product.photo_path} size={40} radius={8} />
      <View style={styles.main}>
        <Text style={[styles.name, { textAlign }]} numberOfLines={1}>
          {isolateBidi(product.name)}
        </Text>
        {loyaltyExcluded || bonusActive ? (
          <View style={styles.badgeRow}>
            {loyaltyExcluded ? (
              <View style={[styles.badge, styles.badgeExcluded]}>
                <Text style={[styles.badgeText, styles.badgeExcludedText]}>
                  {t("loyalty.rowExcluded")}
                </Text>
              </View>
            ) : (
              <View style={[styles.badge, styles.badgeBonus]}>
                <Text style={[styles.badgeText, styles.badgeBonusText]}>
                  {t("loyalty.rowBonus", {
                    points: isolateLtr(String(product.loyalty_bonus_points)),
                  })}
                </Text>
              </View>
            )}
          </View>
        ) : null}
        <Text style={[styles.meta, { textAlign }]} numberOfLines={1}>
          {product.barcode ?? t("productRow.noBarcode")} · {product.stock_quantity}{" "}
          {unitLabel(product.unit, product.stock_quantity, t)}
          {product.is_low_stock ? ` · ${t("productRow.low")}` : ""}
          {product.active ? "" : ` · ${t("productRow.inactive")}`}
        </Text>
      </View>

      <View style={styles.right}>
        <Text style={styles.price}>{formatMAD(product.selling_price_cents)}</Text>

        {showCost &&
          (hasCost ? (
            <>
              <Text style={styles.cost}>
                {t("productRow.buy", { price: isolateLtr(formatMAD(cost)) })}
              </Text>
              <Text style={[styles.profit, belowCost && styles.profitNegative]}>
                {isolateLtr(
                  `${(unitProfit as number) >= 0 ? "+" : ""}${formatMAD(unitProfit as number)} · ${formatMargin(margin)}`
                )}
              </Text>
            </>
          ) : (
            <Text style={styles.cost}>{t("productRow.noCost")}</Text>
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
    backgroundColor: colors.surface,
  },
  highlighted: { backgroundColor: colors.brand100 },
  pressed: { backgroundColor: colors.sunken },
  main: { flex: 1, gap: 3 },
  name: { fontSize: 16, fontWeight: "600" },
  meta: { fontSize: 13, color: colors.ink600 },
  badgeRow: { flexDirection: "row" },
  badge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 1 },
  badgeBonus: { backgroundColor: colors.success100 },
  badgeExcluded: { backgroundColor: colors.sunken },
  badgeText: { fontSize: 13, fontWeight: "700" },
  badgeBonusText: { color: colors.success700 },
  badgeExcludedText: { color: colors.ink700 },
  right: { alignItems: "flex-end", gap: 2 },
  price: { fontSize: 17, fontWeight: "700" },
  cost: { fontSize: 13, color: colors.ink600 },
  profit: { fontSize: 14, color: colors.success700, fontWeight: "700" },
  profitNegative: { color: colors.danger600 },
});
