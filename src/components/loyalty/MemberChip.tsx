import { Pressable, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { Icon } from "@/src/components/ui/Icon";
import { pointsText, valueAndPoints } from "@/src/lib/loyalty/display";
import { formatMaPhone } from "@/src/lib/loyalty/phone";
import type { SaleMember } from "@/src/lib/loyalty/saleMember";
import { isolateBidi, isolateLtr } from "@/src/lib/text/bidi";
import { Text } from "@/src/theme/Text";
import { colors, radius, touch } from "@/src/theme/tokens";

type Props = {
  member: SaleMember;
  pointValueCents: number;
  // Points the basket on screen is expected to earn (null = not worth saying).
  earnPoints: number | null;
  onRemove: () => void;
};

// The loyalty member attached to the sale: who, how much they have (dirhams
// first), what this basket will earn, and a way to detach them.
export function MemberChip({ member, pointValueCents, earnPoints, onRemove }: Props) {
  const { t } = useTranslation();
  const who = member.name
    ? isolateBidi(member.name)
    : member.phone
      ? isolateLtr(formatMaPhone(member.phone))
      : t("loyalty.sellNoName");
  return (
    <View style={styles.chip} testID="member-chip">
      <Icon name="star" size={20} color={colors.brand700} />
      <View style={styles.main}>
        <Text style={styles.who} numberOfLines={1}>
          {who}
        </Text>
        {member.balance !== null ? (
          <Text style={styles.detail} testID="member-balance">
            {valueAndPoints(t, member.balance, pointValueCents)}
          </Text>
        ) : null}
        {member.pending ? (
          <Text style={styles.detail} testID="member-pending">
            {t("loyalty.sellPending")}
          </Text>
        ) : null}
        {earnPoints !== null && earnPoints > 0 ? (
          <Text style={styles.earn} testID="member-earn">
            {t("loyalty.sellWillEarn", { points: pointsText(t, earnPoints) })}
          </Text>
        ) : null}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("loyalty.sellRemove")}
        onPress={onRemove}
        style={styles.remove}
      >
        <Icon name="x" size={20} color={colors.ink700} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    marginHorizontal: 12,
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingStart: 14,
    borderRadius: radius.control,
    backgroundColor: colors.brand100,
  },
  main: { flex: 1, gap: 2, paddingVertical: 8 },
  who: { fontSize: 15, fontWeight: "700", color: colors.brand700 },
  detail: { fontSize: 14, color: colors.ink700 },
  earn: { fontSize: 14, fontWeight: "600", color: colors.success700 },
  remove: {
    minHeight: touch.min,
    minWidth: touch.min,
    alignItems: "center",
    justifyContent: "center",
  },
});
