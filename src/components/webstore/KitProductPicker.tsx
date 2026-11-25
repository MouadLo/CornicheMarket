import { useMemo, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";

import { StatusPill } from "@/src/components/ui/StatusPill";
import { WebImage } from "@/src/components/webstore/WebImage";
import { displayName } from "@/src/components/webstore/WebProductRow";
import { formatMAD } from "@/src/lib/money";
import { isolateBidi, keepNumberLtr } from "@/src/lib/text/bidi";
import { matchesSearch } from "@/src/lib/webstore/filter";
import { effectiveImage, webImageBase } from "@/src/lib/webstore/images";
import { resolvedPriceCents } from "@/src/lib/webstore/resolve";
import type { WebProduct } from "@/src/lib/webstore/types";
import { Text } from "@/src/theme/Text";
import { colors, radius, touch } from "@/src/theme/tokens";

const MAX_SHOWN = 30;

// A searchable list of the site's products to add to a kit. The products
// already in the kit are left out; hidden ones are shown with a badge.
export function KitProductPicker({
  products,
  excludeIds,
  onPick,
}: {
  products: readonly WebProduct[];
  excludeIds: ReadonlySet<string>;
  onPick: (product: WebProduct) => void;
}) {
  const { t } = useTranslation();
  const [term, setTerm] = useState("");
  const shown = useMemo(
    () =>
      products.filter((p) => !excludeIds.has(p.id) && matchesSearch(p, term)).slice(0, MAX_SHOWN),
    [products, excludeIds, term]
  );
  return (
    <View style={styles.box}>
      <TextInput
        style={styles.search}
        value={term}
        onChangeText={setTerm}
        placeholder={t("webstore.search")}
        accessibilityLabel={t("webstore.kits.pickerSearch")}
        placeholderTextColor={colors.ink600}
        autoCapitalize="none"
        autoCorrect={false}
      />
      {shown.length === 0 ? <Text style={styles.none}>{t("webstore.noMatch")}</Text> : null}
      {shown.map((p) => {
        const cents = resolvedPriceCents(p);
        const name = displayName(p);
        return (
          <Pressable
            key={p.id}
            accessibilityRole="button"
            accessibilityLabel={t("webstore.kits.pick", { name })}
            onPress={() => onPick(p)}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          >
            <WebImage uri={effectiveImage(p, webImageBase())} size={40} />
            <View style={styles.text}>
              <Text style={styles.title} numberOfLines={1}>
                {isolateBidi(name)}
                {p.size ? ` · ${p.size}` : ""}
              </Text>
              <Text style={styles.price}>
                {cents === null ? t("webstore.priceToConfirm") : keepNumberLtr(formatMAD(cents))}
              </Text>
            </View>
            {!p.published ? (
              <StatusPill tone="warn" icon="eyeOff" label={t("webstore.kits.badge.hidden")} />
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 8 },
  search: {
    minHeight: 52,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.ink400,
    paddingHorizontal: 16,
    fontSize: 16,
    backgroundColor: colors.white,
  },
  none: { fontSize: 15, color: colors.ink600 },
  row: {
    minHeight: touch.min,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  pressed: { opacity: 0.7 },
  text: { flex: 1, gap: 2 },
  title: { fontSize: 15, fontWeight: "600", color: colors.ink900 },
  price: { fontSize: 14, color: colors.ink700 },
});
