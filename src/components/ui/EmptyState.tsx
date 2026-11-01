import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { Text } from "@/src/theme/Text";
import { colors, spacing } from "@/src/theme/tokens";
import { Icon, type IconName } from "./Icon";

// One pattern for empty, error and offline: round icon, title, one sentence,
// at most one action.
export function EmptyState({
  icon,
  title,
  message,
  action,
  tone = "neutral",
}: {
  icon: IconName;
  title: string;
  message?: string;
  action?: ReactNode;
  tone?: "neutral" | "warn" | "bad";
}) {
  const circle =
    tone === "bad"
      ? { bg: colors.danger100, fg: colors.danger700 }
      : tone === "warn"
        ? { bg: colors.warning100, fg: colors.warning700 }
        : { bg: colors.sunken, fg: colors.ink600 };
  return (
    <View style={styles.wrap}>
      <View style={[styles.circle, { backgroundColor: circle.bg }]}>
        <Icon name={icon} size={32} color={circle.fg} />
      </View>
      <Text style={styles.title}>{title}</Text>
      {message ? <Text style={styles.message}>{message}</Text> : null}
      {action ? <View style={styles.action}>{action}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", gap: spacing.s2, padding: spacing.s5 },
  circle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontSize: 20, fontWeight: "600", color: colors.ink900, textAlign: "center" },
  message: { fontSize: 17, color: colors.ink600, textAlign: "center", maxWidth: 420 },
  action: { marginTop: spacing.s3, minWidth: 200 },
});
