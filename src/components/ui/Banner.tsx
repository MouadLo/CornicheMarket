import { Pressable, StyleSheet, View } from "react-native";

import { Text } from "@/src/theme/Text";
import { colors, radius, spacing } from "@/src/theme/tokens";
import { Icon, type IconName } from "./Icon";

export type BannerTone = "info" | "warn" | "bad" | "ok";

const palette: Record<BannerTone, { bg: string; fg: string; icon: IconName }> = {
  info: { bg: colors.brand100, fg: colors.brand700, icon: "info" },
  warn: { bg: colors.warning100, fg: colors.warning700, icon: "alert" },
  bad: { bg: colors.danger100, fg: colors.danger700, icon: "alert" },
  ok: { bg: colors.success100, fg: colors.success700, icon: "check" },
};

// A state that lasts (offline, backup overdue, incomplete lines). One-off
// confirmations are toasts, not banners.
export function Banner({
  tone = "info",
  text,
  icon,
  action,
}: {
  tone?: BannerTone;
  text: string;
  icon?: IconName;
  action?: { label: string; onPress: () => void };
}) {
  const p = palette[tone];
  return (
    <View style={[styles.banner, { backgroundColor: p.bg }]} accessibilityRole="alert">
      <Icon name={icon ?? p.icon} size={22} color={p.fg} />
      <Text style={[styles.text, { color: p.fg }]}>{text}</Text>
      {action ? (
        <Pressable accessibilityRole="button" onPress={action.onPress} style={styles.action}>
          <Text style={[styles.actionText, { color: p.fg }]}>{action.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    minHeight: 48,
    borderRadius: radius.control,
    paddingVertical: spacing.s2,
    paddingHorizontal: spacing.s4,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.s3,
  },
  text: { flex: 1, fontSize: 17, fontWeight: "500" },
  action: { minHeight: 48, paddingHorizontal: spacing.s2, justifyContent: "center" },
  actionText: { fontSize: 17, fontWeight: "700", textDecorationLine: "underline" },
});
