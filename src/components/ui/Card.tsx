import type { ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { Text } from "@/src/theme/Text";
import { colors, radius, spacing } from "@/src/theme/tokens";

// White container, 16 radius, 16 padding, one soft shadow.
export function Card({
  title,
  children,
  style,
}: {
  title?: string;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.card, style]}>
      {title ? <Text style={styles.title}>{title}</Text> : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.panel,
    padding: spacing.s4,
    shadowColor: colors.ink900,
    shadowOpacity: 0.07,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  title: { fontSize: 15, fontWeight: "700", color: colors.ink700, marginBottom: spacing.s2 },
});
