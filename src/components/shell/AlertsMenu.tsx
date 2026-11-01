import { router } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { Badge } from "@/src/components/ui/Badge";
import { Icon, type IconName } from "@/src/components/ui/Icon";
import { Popover } from "@/src/components/ui/Popover";
import type { AlertCounts, ReviewKind } from "@/src/lib/alerts/queries";
import { Text } from "@/src/theme/Text";
import { colors, spacing } from "@/src/theme/tokens";
import { TOPBAR_HEIGHT } from "./TopBar";

// What the owner has to look at, with counts. Each row opens the place where
// it is dealt with; rows with nothing to do are not shown.
export function AlertsMenu({
  visible,
  onClose,
  counts,
  stuck,
  onReview,
  onStuck,
}: {
  visible: boolean;
  onClose: () => void;
  counts: AlertCounts;
  stuck: number;
  onReview: (kind: ReviewKind) => void;
  onStuck: () => void;
}) {
  const { t } = useTranslation();
  type Row = { key: string; icon: IconName; label: string; count: number; onPress: () => void };
  const all: Row[] = [
    {
      key: "price",
      icon: "tag",
      label: t("shell.alertPrice"),
      count: counts.price,
      onPress: () => onReview("price"),
    },
    {
      key: "discount",
      icon: "alert",
      label: t("shell.alertDiscount"),
      count: counts.discount,
      onPress: () => onReview("discount"),
    },
    {
      key: "negative",
      icon: "package",
      label: t("shell.alertNegative"),
      count: counts.negativeStock,
      onPress: () => {
        onClose();
        router.navigate("/(app)/stock-in/negative-stock" as never);
      },
    },
    { key: "stuck", icon: "wifiOff", label: t("shell.alertStuck"), count: stuck, onPress: onStuck },
  ];
  const rows = all.filter((r) => r.count > 0);

  return (
    <Popover visible={visible} onClose={onClose} top={TOPBAR_HEIGHT + 4} width={380}>
      <View style={styles.head}>
        <Text style={styles.title}>{t("shell.alertsTitle")}</Text>
      </View>
      {rows.length === 0 ? (
        <View style={styles.none}>
          <Icon name="check" color={colors.success700} />
          <Text style={styles.noneText}>{t("shell.alertsNone")}</Text>
        </View>
      ) : (
        rows.map((r) => (
          <Pressable key={r.key} accessibilityRole="button" onPress={r.onPress} style={styles.row}>
            <Icon name={r.icon} color={colors.warning700} />
            <Text style={styles.label}>{r.label}</Text>
            <Badge
              value={r.count}
              tone={r.key === "stuck" || r.key === "negative" ? "bad" : "warn"}
            />
            <Icon name="chevron" size={18} color={colors.ink600} />
          </Pressable>
        ))
      )}
    </Popover>
  );
}

const styles = StyleSheet.create({
  head: { padding: spacing.s4, borderBottomWidth: 1, borderBottomColor: colors.divider },
  title: { fontSize: 17, fontWeight: "700", color: colors.ink900 },
  none: { flexDirection: "row", alignItems: "center", gap: spacing.s3, padding: spacing.s4 },
  noneText: { fontSize: 17, color: colors.ink700 },
  row: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.s3,
    paddingHorizontal: spacing.s4,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  label: { flex: 1, fontSize: 17, fontWeight: "600", color: colors.ink900 },
});
