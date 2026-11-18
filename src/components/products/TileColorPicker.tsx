import { Pressable, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { Icon } from "@/src/components/ui/Icon";
import { formatMADGrouped } from "@/src/lib/money";
import type { TileColor } from "@/src/lib/sellGrid/layout";
import { TILE_COLORS } from "@/src/lib/sellGrid/tileSettings";
import { Text } from "@/src/theme/Text";
import { colors, radius, tilePalette } from "@/src/theme/tokens";

// The product's tile colour: large swatches, each with its name and a check mark
// on the chosen one (so the choice is never colour alone). null = the default.
export function TileColorPicker({
  value,
  onChange,
}: {
  value: TileColor | null;
  onChange: (color: TileColor | null) => void;
}) {
  const { t } = useTranslation();
  const options: (TileColor | null)[] = [null, ...TILE_COLORS];
  return (
    <View
      style={styles.grid}
      accessibilityRole="radiogroup"
      accessibilityLabel={t("products.formTileColor")}
    >
      {options.map((option) => {
        const name = option
          ? t(`products.formTileColors.${option}`)
          : t("products.formTileColorDefault");
        const selected = option === value;
        const palette = tilePalette[option ?? "grey"];
        return (
          <Pressable
            key={option ?? "default"}
            accessibilityRole="radio"
            accessibilityLabel={name}
            accessibilityState={{ checked: selected, selected }}
            onPress={() => onChange(option)}
            style={styles.option}
          >
            <View
              style={[
                styles.swatch,
                { backgroundColor: palette.tint, borderColor: palette.strip },
                selected && styles.swatchOn,
                option === null && styles.swatchDefault,
              ]}
            >
              {selected ? <Icon name="check" size={28} color={colors.ink900} /> : null}
            </View>
            <Text style={[styles.name, selected && styles.nameOn]}>{name}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// What the tile looks like on Sell: the same tint, and the strip on the start edge.
export function TilePreview({
  name,
  priceCents,
  color,
}: {
  name: string;
  priceCents: number | null;
  color: TileColor | null;
}) {
  const { t } = useTranslation();
  const palette = tilePalette[color ?? "grey"];
  return (
    <View
      style={[styles.preview, { backgroundColor: palette.tint }]}
      accessibilityLabel={t("products.formTilePreview")}
    >
      <View style={[styles.strip, { backgroundColor: palette.strip }]} />
      <View style={styles.previewBody}>
        <Text style={styles.previewName} numberOfLines={2}>
          {name.trim() || t("products.formTileNamePlaceholder")}
        </Text>
        <Text style={styles.previewPrice}>
          {priceCents === null ? "—" : formatMADGrouped(priceCents)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  option: { width: 84, alignItems: "center", gap: 4 },
  swatch: {
    width: 64,
    height: 64,
    borderRadius: radius.control,
    borderWidth: 3,
    alignItems: "center",
    justifyContent: "center",
  },
  swatchOn: { borderColor: colors.ink900 },
  swatchDefault: { borderStyle: "dashed" },
  name: { fontSize: 13, color: colors.ink700, textAlign: "center" },
  nameOn: { fontWeight: "700", color: colors.ink900 },
  preview: {
    flexDirection: "row",
    alignItems: "stretch",
    minHeight: 76,
    width: 168,
    borderRadius: radius.control,
    overflow: "hidden",
  },
  strip: { width: 6 },
  previewBody: { flex: 1, padding: 10, gap: 4, justifyContent: "space-between" },
  previewName: { fontSize: 15, fontWeight: "600", color: colors.ink900 },
  previewPrice: { fontSize: 17, fontWeight: "700", color: colors.ink900 },
});
