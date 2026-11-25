import { Pressable, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { IconButton } from "@/src/components/webstore/IconButton";
import { StatusPill } from "@/src/components/ui/StatusPill";
import { displayName } from "@/src/components/webstore/WebProductRow";
import { WebImage } from "@/src/components/webstore/WebImage";
import { formatMAD } from "@/src/lib/money";
import { isolateBidi, keepNumberLtr } from "@/src/lib/text/bidi";
import { effectiveImage, webImageBase } from "@/src/lib/webstore/images";
import { KIT_QTY_MAX, KIT_QTY_MIN, type ItemProblemKind } from "@/src/lib/webstore/kits";
import { resolvedPriceCents } from "@/src/lib/webstore/resolve";
import type { WebProduct } from "@/src/lib/webstore/types";
import { Text } from "@/src/theme/Text";
import { colors } from "@/src/theme/tokens";

type Props = {
  webProductId: string;
  // null: the product no longer exists.
  product: WebProduct | null;
  qty: number;
  problem: ItemProblemKind | "tooManyItems" | null;
  isFirst: boolean;
  isLast: boolean;
  onQty: (qty: number) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
};

// One line of a kit: photo, name, price, problem badge, quantity stepper,
// move up / down and remove. A product that no longer exists can only be removed.
export function KitItemRow({
  webProductId,
  product,
  qty,
  problem,
  isFirst,
  isLast,
  onQty,
  onMove,
  onRemove,
}: Props) {
  const { t } = useTranslation();
  const name = product
    ? displayName(product)
    : t("webstore.kits.missingProduct", { id: webProductId });
  const cents = product ? resolvedPriceCents(product) : null;
  return (
    <View style={styles.row}>
      <View style={styles.head}>
        <WebImage uri={product ? effectiveImage(product, webImageBase()) : null} />
        <View style={styles.text}>
          <Text style={styles.title} numberOfLines={2}>
            {product ? isolateBidi(name) : name}
          </Text>
          {product ? (
            <Text style={styles.price}>
              {cents === null ? t("webstore.priceToConfirm") : keepNumberLtr(formatMAD(cents))}
            </Text>
          ) : null}
          {problem && problem !== "missing" ? (
            <StatusPill
              tone={problem === "tooManyItems" ? "neutral" : "warn"}
              icon="alert"
              label={t(`webstore.kits.badge.${problem}`)}
            />
          ) : null}
        </View>
      </View>
      <View style={styles.controls}>
        {product ? (
          <View style={styles.stepper}>
            <IconButton
              icon="minus"
              label={t("webstore.kits.qtyLess", { name })}
              disabled={qty <= KIT_QTY_MIN}
              onPress={() => onQty(qty - 1)}
            />
            <Text style={styles.qty} accessibilityLabel={t("webstore.kits.qtyValue", { qty })}>
              {qty}
            </Text>
            <IconButton
              icon="plus"
              label={t("webstore.kits.qtyMore", { name })}
              disabled={qty >= KIT_QTY_MAX}
              onPress={() => onQty(qty + 1)}
            />
          </View>
        ) : null}
        <View style={styles.stepper}>
          <IconButton
            icon="arrowUp"
            label={t("webstore.kits.moveUp", { name })}
            disabled={isFirst}
            onPress={() => onMove(-1)}
          />
          <IconButton
            icon="arrowDown"
            label={t("webstore.kits.moveDown", { name })}
            disabled={isLast}
            onPress={() => onMove(1)}
          />
          <IconButton icon="trash" label={t("webstore.kits.remove", { name })} onPress={onRemove} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    gap: 8,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  head: { flexDirection: "row", alignItems: "center", gap: 12 },
  text: { flex: 1, gap: 3 },
  title: { fontSize: 16, fontWeight: "600", color: colors.ink900 },
  price: { fontSize: 15, color: colors.ink700 },
  controls: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 12 },
  stepper: { flexDirection: "row", alignItems: "center", gap: 4 },
  qty: { minWidth: 32, textAlign: "center", fontSize: 18, fontWeight: "700", color: colors.ink900 },
});
