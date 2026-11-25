import { Pressable, StyleSheet, Switch, View } from "react-native";
import { useTranslation } from "react-i18next";

import { WebImage } from "@/src/components/webstore/WebImage";
import { StatusPill } from "@/src/components/ui/StatusPill";
import { formatMAD } from "@/src/lib/money";
import { isExcluded, resolvedInStock, resolvedPriceCents } from "@/src/lib/webstore/resolve";
import type { WebProduct } from "@/src/lib/webstore/types";
import { isolateBidi, keepNumberLtr } from "@/src/lib/text/bidi";
import { Text } from "@/src/theme/Text";
import { colors, touch } from "@/src/theme/tokens";

export const displayName = (p: Pick<WebProduct, "name" | "name_fr">) =>
  (p.name_fr ?? "").trim() || p.name;

type Props = {
  product: WebProduct;
  onOpen: () => void;
  onTogglePublished: (published: boolean) => void;
  busy?: boolean;
};

// One line of the webstore list: photo, name and size, price, stock and link
// state, and the publish switch (which saves at once).
export function WebProductRow({ product, onOpen, onTogglePublished, busy }: Props) {
  const { t } = useTranslation();
  const name = displayName(product);
  const cents = resolvedPriceCents(product);
  const inStock = resolvedInStock(product);
  const excluded = product.published && isExcluded(product);
  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={name}
        onPress={onOpen}
        style={({ pressed }) => [styles.main, pressed && styles.pressed]}
      >
        <WebImage uri={product.image_url} />
        <View style={styles.text}>
          <Text style={styles.title} numberOfLines={1}>
            {isolateBidi(name)}
            {product.size ? ` · ${product.size}` : ""}
          </Text>
          <Text style={[styles.price, cents === null && styles.priceMissing]}>
            {cents === null ? t("webstore.priceToConfirm") : keepNumberLtr(formatMAD(cents))}
          </Text>
          <View style={styles.pills}>
            <StatusPill
              tone={inStock ? "ok" : "bad"}
              icon={inStock ? "check" : "x"}
              label={`${inStock ? t("webstore.inStock") : t("webstore.outOfStock")}${
                product.stock_mode === "auto" ? ` · ${t("webstore.auto")}` : ""
              }`}
            />
            {excluded ? (
              <StatusPill tone="warn" icon="alert" label={t("webstore.notShown")} />
            ) : null}
          </View>
          <Text style={styles.link} numberOfLines={1}>
            {product.product_id
              ? t("webstore.linkedTo", {
                  name: isolateBidi(product.app?.name ?? product.product_id),
                })
              : t("webstore.notLinked")}
          </Text>
        </View>
      </Pressable>
      <Switch
        value={product.published}
        onValueChange={onTogglePublished}
        disabled={busy}
        accessibilityLabel={t("webstore.publishA11y", { name })}
        trackColor={{ true: colors.brand700, false: colors.border }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    minHeight: touch.lg,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  main: { flex: 1, flexDirection: "row", alignItems: "center", gap: 12 },
  pressed: { opacity: 0.7 },
  text: { flex: 1, gap: 3 },
  title: { fontSize: 16, fontWeight: "600", color: colors.ink900 },
  price: { fontSize: 15, color: colors.ink700 },
  priceMissing: { color: colors.warning700, fontWeight: "600" },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  link: { fontSize: 13, color: colors.ink600 },
});
