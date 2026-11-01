import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View, type LayoutChangeEvent } from "react-native";
import { useTranslation } from "react-i18next";

import { Icon } from "@/src/components/ui/Icon";
import { formatMADGrouped } from "@/src/lib/money";
import {
  stockLevel,
  tileColumns,
  type GridProduct,
  type ResolvedTab,
  type ResolvedTile,
} from "@/src/lib/sellGrid/layout";
import { isolateBidi, isolateLtr } from "@/src/lib/text/bidi";
import { Text } from "@/src/theme/Text";
import { colors, radius, spacing, tilePalette } from "@/src/theme/tokens";
import { tabularNumbers } from "@/src/theme/type";

const GAP = 10;

type Props = {
  tabs: ResolvedTab[];
  // Quantity of each product already in the basket, for the "×N" badge.
  inCart: Record<string, number>;
  onAdd: (product: GridProduct) => void;
  activeTabId?: string | null;
  onTabChange?: (id: string) => void;
};

// Category tabs and tiles. Tapping a tile adds it (a weighed product opens the
// weight pad, as scanning one does). Every tile is tappable whatever its stock.
export function ProductGrid({ tabs, inCart, onAdd, activeTabId, onTabChange }: Props) {
  const { t } = useTranslation();
  const [localTab, setLocalTab] = useState<string | null>(null);
  const [paneWidth, setPaneWidth] = useState(0);

  const current = tabs.find((x) => x.id === (activeTabId ?? localTab)) ?? tabs[0];
  const columns = tileColumns(paneWidth || 760);
  const tileWidth = paneWidth
    ? Math.floor((paneWidth - GAP * (columns - 1) - spacing.s4 * 2) / columns)
    : 124;
  const select = (id: string) => {
    setLocalTab(id);
    onTabChange?.(id);
  };

  const tiles = useMemo(() => current?.tiles ?? [], [current]);
  if (!current) return null;

  return (
    <View
      style={styles.wrap}
      onLayout={(e: LayoutChangeEvent) => setPaneWidth(e.nativeEvent.layout.width)}
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabsScroll}
        contentContainerStyle={styles.tabs}
        accessibilityLabel={t("sell.grid.tabs")}
      >
        {tabs.map((tab) => {
          const on = tab.id === current.id;
          return (
            <Pressable
              key={tab.id}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              onPress={() => select(tab.id)}
              style={[styles.tab, on && styles.tabOn]}
            >
              {tab.kind === "favorites" ? (
                <Icon name="star" size={18} color={on ? colors.white : colors.sand500} />
              ) : null}
              <Text style={[styles.tabText, on && styles.tabTextOn]} numberOfLines={1}>
                {isolateBidi(tab.label)}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <ScrollView contentContainerStyle={styles.tiles}>
        {tiles.map((tile) => (
          <Tile
            key={tile.key}
            tile={tile}
            width={tileWidth}
            count={inCart[tile.product.id] ?? 0}
            onPress={() => onAdd(tile.product)}
          />
        ))}
      </ScrollView>
    </View>
  );
}

function Tile({
  tile,
  width,
  count,
  onPress,
}: {
  tile: ResolvedTile;
  width: number;
  count: number;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const { product } = tile;
  const palette = tilePalette[tile.color ?? "grey"];
  const kg = product.unit === "kg";
  const amount = formatMADGrouped(product.selling_price_cents).replace(" DH", "");
  const price = `${amount}${kg ? "/kg" : " DH"}`;
  const level = stockLevel(product.stock_quantity, product.low_stock_threshold);
  const stock = kg ? product.stock_quantity.toFixed(1) : String(product.stock_quantity);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        count > 0
          ? t("sell.grid.tileLabel", { name: product.name, price, count })
          : t("sell.grid.tileLabelEmpty", { name: product.name, price })
      }
      onPress={onPress}
      style={({ pressed }) => [
        styles.tile,
        { width, backgroundColor: palette.tint },
        pressed && styles.tilePressed,
      ]}
    >
      <View style={[styles.strip, { backgroundColor: palette.strip }]} />
      <View style={styles.tileTop}>
        <Text style={styles.name} numberOfLines={2}>
          {isolateBidi(tile.label)}
        </Text>
        {count > 0 ? (
          <View style={styles.qty}>
            <Text style={[styles.qtyText, tabularNumbers]}>{kg ? "✓" : `×${count}`}</Text>
          </View>
        ) : kg ? (
          <Icon name="scale" size={18} color={colors.ink600} />
        ) : null}
      </View>
      <View style={styles.tileBottom}>
        <Text style={styles.priceLine} numberOfLines={1}>
          <Text style={[styles.price, tabularNumbers]}>{isolateLtr(amount)}</Text>
          <Text style={styles.unit}>{isolateLtr(kg ? "/kg" : " DH")}</Text>
        </Text>
        <View
          style={[
            styles.stock,
            level === "low" && styles.stockLow,
            level === "out" && styles.stockOut,
          ]}
          accessibilityLabel={t("sell.grid.stockLabel", { count: stock })}
        >
          <Text
            style={[
              styles.stockText,
              tabularNumbers,
              level === "out" && styles.stockTextOut,
              level === "low" && styles.stockTextLow,
            ]}
          >
            {isolateLtr(stock)}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, minHeight: 0 },
  tabsScroll: { flexGrow: 0 },
  tabs: { gap: spacing.s2, paddingHorizontal: spacing.s4, paddingVertical: spacing.s3 },
  tab: {
    minHeight: 52,
    paddingHorizontal: 18,
    borderRadius: radius.pill,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tabOn: { backgroundColor: colors.brand700, borderColor: colors.brand700 },
  tabText: { fontSize: 17, fontWeight: "600", color: colors.ink700 },
  tabTextOn: { color: colors.white },
  tiles: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: GAP,
    paddingHorizontal: spacing.s4,
    paddingBottom: spacing.s4,
  },
  tile: {
    height: 104,
    borderRadius: radius.control,
    overflow: "hidden",
    paddingVertical: 10,
    paddingStart: 16,
    paddingEnd: 10,
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: "rgba(21,33,43,0.07)",
  },
  tilePressed: { opacity: 0.8, transform: [{ scale: 0.97 }] },
  strip: { position: "absolute", top: 0, bottom: 0, start: 0, width: 6 },
  tileTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 4,
  },
  name: { flex: 1, fontSize: 17, fontWeight: "600", color: colors.ink900, lineHeight: 20 },
  qty: {
    minWidth: 24,
    height: 24,
    paddingHorizontal: 7,
    borderRadius: 12,
    backgroundColor: colors.brand700,
    alignItems: "center",
    justifyContent: "center",
  },
  qtyText: { fontSize: 13, fontWeight: "700", color: colors.white },
  tileBottom: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" },
  priceLine: { flexShrink: 1 },
  price: { fontSize: 20, fontWeight: "700", color: colors.ink900 },
  unit: { fontSize: 13, fontWeight: "600", color: colors.ink600 },
  stock: {
    minWidth: 26,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.65)",
  },
  stockLow: { backgroundColor: colors.warning100 },
  stockOut: { backgroundColor: colors.danger600 },
  stockText: { fontSize: 13, fontWeight: "600", color: colors.ink600 },
  stockTextLow: { color: colors.warning700 },
  stockTextOut: { color: colors.white },
});
