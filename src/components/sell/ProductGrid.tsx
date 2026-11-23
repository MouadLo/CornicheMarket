import { useEffect, useMemo, useState } from "react";
import {
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from "react-native";
import { useTranslation } from "react-i18next";

import { Icon } from "@/src/components/ui/Icon";
import { formatMADGrouped } from "@/src/lib/money";
import { usePhotoUrl } from "@/src/lib/products/photoUrls";
import {
  stockLevel,
  priceFontSize,
  tileColumns,
  type GridProduct,
  type ResolvedTab,
  type ResolvedTile,
} from "@/src/lib/sellGrid/layout";
import { appDirection, isolateBidi, isolateLtr } from "@/src/lib/text/bidi";
import { Text } from "@/src/theme/Text";
import { colors, radius, spacing, tilePalette } from "@/src/theme/tokens";
import { tabularNumbers } from "@/src/theme/type";

export const GAP = 10;
export const TILE_HEIGHT = 104;

type Props = {
  tabs: ResolvedTab[];
  // Quantity of each product already in the basket, for the "×N" badge.
  inCart: Record<string, number>;
  onAdd: (product: GridProduct) => void;
  activeTabId?: string | null;
  onTabChange?: (id: string) => void;
  // Owner only: switches the grid into arrange mode. Cashiers get no control.
  onArrange?: () => void;
  // The built-in "Montant libre" tile: always first on every tab, never part of
  // the owner's arrangement. Absent (null) while the device does not know the
  // Divers product yet, so there is no tile rather than a broken one.
  divers?: { count: number; onPress: () => void } | null;
};

// The grid's columns and tile width for a pane, shared with the arrange mode so
// both draw the same tiles in the same places.
export function gridMetrics(paneWidth: number) {
  const columns = tileColumns(paneWidth || 760);
  const tileWidth = paneWidth
    ? Math.floor((paneWidth - GAP * (columns - 1) - spacing.s4 * 2) / columns)
    : 132;
  return { columns, tileWidth };
}

// Category tabs and tiles. Tapping a tile adds it (a weighed product opens the
// weight pad, as scanning one does). Every tile is tappable whatever its stock.
export function ProductGrid({
  tabs,
  inCart,
  onAdd,
  activeTabId,
  onTabChange,
  onArrange,
  divers,
}: Props) {
  const { t } = useTranslation();
  const [localTab, setLocalTab] = useState<string | null>(null);
  const [paneWidth, setPaneWidth] = useState(0);

  const current = tabs.find((x) => x.id === (activeTabId ?? localTab)) ?? tabs[0];
  const { tileWidth } = gridMetrics(paneWidth);
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
      <View style={styles.tabsRow}>
        {/* Takes the row's spare width (and gives it up), so the arrange button
            always fits; the strip itself still never shrinks in height. */}
        <View style={styles.tabsWrap}>
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
        </View>
        {onArrange ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("sell.grid.arrange")}
            onPress={onArrange}
            style={styles.arrange}
          >
            <Icon name="sliders" size={22} color={colors.brand700} />
            {paneWidth >= 640 ? (
              <Text style={styles.arrangeText} numberOfLines={1}>
                {t("sell.grid.arrange")}
              </Text>
            ) : null}
          </Pressable>
        ) : null}
      </View>

      <ScrollView style={styles.tilesScroll} contentContainerStyle={styles.tiles}>
        {divers ? (
          <DiversTile width={tileWidth} count={divers.count} onPress={divers.onPress} />
        ) : null}
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

// "Montant libre": white with a 2 px outline, so it is never mistaken for a
// product. No price and no stock badge (it tracks no stock).
export function DiversTile({
  width,
  count,
  onPress,
}: {
  width: number;
  count: number;
  onPress: () => void;
}) {
  const { t, i18n } = useTranslation();
  const language = i18n?.language;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        count > 0 ? t("sell.diversTileLabel", { count }) : t("sell.diversTileLabelEmpty")
      }
      testID="divers-tile"
      onPress={onPress}
      style={({ pressed }) => [
        styles.tile,
        styles.diversTile,
        { width },
        pressed && styles.tilePressed,
      ]}
    >
      <View style={styles.tileTop}>
        <Text style={[styles.name, namePad(language)]} numberOfLines={2}>
          {isolateBidi(t("sell.diversTile"))}
        </Text>
      </View>
      {count > 0 ? (
        <View
          style={[styles.qty, cornerSide(language, 3)]}
          testID="divers-qty-badge"
          pointerEvents="none"
        >
          <Text style={[styles.qtyText, tabularNumbers]}>{`×${count}`}</Text>
        </View>
      ) : null}
      <View style={styles.tileBottom}>
        <Icon name="pencil" size={22} color={colors.brand700} />
      </View>
    </Pressable>
  );
}

// On web, Arabic only sets dir="rtl" on the page, and absolutely positioned
// start/end do not follow it, so the corner side is chosen here. Native flips
// left/right itself once RTL is forced (src/i18n), so it keeps start/end.
function cornerSide(language: string | undefined, inset: number) {
  if (Platform.OS === "web") return language === "ar" ? { left: inset } : { right: inset };
  return { end: inset };
}

// The name keeps the corner free on the same side (see styles.name): room for
// the badge, or for the photo when the tile has one.
function namePad(language: string | undefined, pad = 16) {
  if (Platform.OS === "web")
    return language === "ar" ? { paddingLeft: pad } : { paddingRight: pad };
  return { paddingEnd: pad };
}

// Also drawn by the arrange mode (ArrangeGrid), which passes no onPress.
export function Tile({
  tile,
  width,
  count,
  onPress,
}: {
  tile: ResolvedTile;
  width: number;
  count: number;
  onPress?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const language = i18n?.language;
  const { product } = tile;
  const palette = tilePalette[tile.color ?? "grey"];
  const kg = product.unit === "kg";
  const amount = formatMADGrouped(product.selling_price_cents).replace(" DH", "");
  const price = `${amount}${kg ? "/kg" : " DH"}`;
  const level = stockLevel(product.stock_quantity, product.low_stock_threshold);
  const stock = kg ? product.stock_quantity.toFixed(1) : String(product.stock_quantity);
  // The photo, when its URL is known and the file loads. Otherwise the tile is
  // drawn exactly as it is without a photo (never a broken image).
  const photoUrl = usePhotoUrl(product.photo_path);
  const [photoFailed, setPhotoFailed] = useState(false);
  useEffect(() => setPhotoFailed(false), [photoUrl]);
  const showPhoto = !!photoUrl && !photoFailed;

  const label =
    count > 0
      ? t("sell.grid.tileLabel", { name: product.name, price, count })
      : t("sell.grid.tileLabelEmpty", { name: product.name, price });
  const content = (
    <>
      <View style={[styles.strip, { backgroundColor: palette.strip }]} />
      <View style={styles.tileTop}>
        {/* With a photo in the top end corner, the name keeps its full text (the
            size matters at the counter: 33cl vs 1L) on up to three smaller lines. */}
        <Text
          style={[
            styles.name,
            showPhoto && styles.nameWithPhoto,
            namePad(language, showPhoto ? 44 : 16),
          ]}
          numberOfLines={showPhoto ? 3 : 2}
        >
          {isolateBidi(tile.label)}
        </Text>
      </View>
      {showPhoto ? (
        <Image
          source={{ uri: photoUrl }}
          style={[styles.photo, cornerSide(language, 10)]}
          resizeMode="cover"
          accessibilityIgnoresInvertColors
          onError={() => setPhotoFailed(true)}
          testID="tile-photo"
        />
      ) : null}
      {/* The end corner holds the basket badge, or the scale for a weighed
          product not yet in the basket. Overlaid, so the name's width never
          changes (C16). */}
      {count > 0 ? (
        <View
          style={[styles.qty, cornerSide(language, 3)]}
          testID="tile-qty-badge"
          pointerEvents="none"
        >
          <Text style={[styles.qtyText, tabularNumbers]}>{kg ? "✓" : `×${count}`}</Text>
        </View>
      ) : kg && !showPhoto ? (
        <View style={[styles.corner, cornerSide(language, 5)]} pointerEvents="none">
          <Icon name="scale" size={18} color={colors.ink600} />
        </View>
      ) : null}
      <View style={styles.tileBottom}>
        <View
          style={[styles.priceLine, appDirection(language ?? "") === "rtl" && styles.priceLineRtl]}
        >
          <Text
            style={[
              styles.price,
              tabularNumbers,
              { fontSize: Math.max(13, priceFontSize(amount, width)) },
            ]}
            numberOfLines={1}
          >
            {isolateLtr(amount)}
          </Text>
          {/* Its own element: when space is short the number shrinks, never the unit. */}
          <Text style={styles.unit}>{isolateLtr(kg ? "/kg" : " DH")}</Text>
        </View>
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
    </>
  );

  // Arrange mode draws the tile with nothing to tap. A disabled Pressable would
  // be a disabled <button> on web, and browsers deliver no mouse presses to it
  // or anything inside it, so the drag around it would never start.
  if (!onPress) {
    return (
      <View
        accessibilityLabel={label}
        style={[styles.tile, { width, backgroundColor: palette.tint }]}
      >
        {content}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.tile,
        { width, backgroundColor: palette.tint },
        pressed && styles.tilePressed,
      ]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, minHeight: 0 },
  // Never shrinks: on web a long tile list would otherwise squeeze the tabs.
  tabsScroll: { flexGrow: 0, flexShrink: 0 },
  tabsWrap: { flex: 1, minWidth: 0 },
  tabsRow: { flexDirection: "row", alignItems: "center", flexGrow: 0, flexShrink: 0 },
  arrange: {
    minHeight: 48,
    minWidth: 48,
    marginEnd: spacing.s4,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  arrangeText: { fontSize: 15, fontWeight: "600", color: colors.brand700 },
  tilesScroll: { flex: 1, minHeight: 0 },
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
    height: TILE_HEIGHT,
    borderRadius: radius.control,
    overflow: "hidden",
    paddingVertical: 10,
    paddingStart: 16,
    paddingEnd: 10,
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: "rgba(21,33,43,0.07)",
  },
  diversTile: { backgroundColor: colors.white, borderWidth: 2, borderColor: colors.brand700 },
  tilePressed: { opacity: 0.8, transform: [{ scale: 0.97 }] },
  strip: { position: "absolute", top: 0, bottom: 0, start: 0, width: 6 },
  tileTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 4,
  },
  // namePad() always reserves the badge's corner, so the name never runs
  // under it and its width does not change when the badge appears (C16).
  name: {
    flex: 1,
    fontSize: 17,
    fontWeight: "600",
    color: colors.ink900,
    lineHeight: 20,
  },
  corner: { position: "absolute", top: 6 },
  // Three lines of 18 px end at 64, above the price and stock row (72-94).
  nameWithPhoto: { fontSize: 15, lineHeight: 18 },
  // 36 px square in the top end corner. The basket badge, drawn after it, sits
  // on its corner. Overlaid, so the tile keeps its size.
  photo: {
    position: "absolute",
    top: 8,
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.65)",
  },
  qty: {
    position: "absolute",
    top: 4,
    minWidth: 22,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: 11,
    backgroundColor: colors.brand700,
    alignItems: "center",
    justifyContent: "center",
  },
  qtyText: { fontSize: 13, fontWeight: "700", color: colors.white },
  tileBottom: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" },
  priceLine: { flexShrink: 1, flexDirection: "row", alignItems: "flex-end" },
  // "9.00" then "/kg" are two elements; in Arabic a plain row lays them out
  // right to left ("/kg9.00"). An amount always reads left to right.
  priceLineRtl: { flexDirection: "row-reverse", justifyContent: "flex-end" },
  price: { flexShrink: 1, fontSize: 20, fontWeight: "700", color: colors.ink900 },
  unit: { flexShrink: 0, fontSize: 13, fontWeight: "600", color: colors.ink600 },
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
