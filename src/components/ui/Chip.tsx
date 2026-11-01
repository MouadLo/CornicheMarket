import { Pressable, StyleSheet } from "react-native";

import { Text } from "@/src/theme/Text";
import { colors, touch } from "@/src/theme/tokens";
import { tabularNumbers } from "@/src/theme/type";
import { Icon, type IconName } from "./Icon";

type Props = {
  label: string;
  selected?: boolean;
  onPress: () => void;
  icon?: IconName;
  count?: number;
};

// Filters (not navigation): one or more chips toggled in a row.
export function Chip({ label, selected, onPress, icon, count }: Props) {
  const fg = selected ? colors.white : colors.ink700;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      style={({ pressed }) => [styles.chip, selected && styles.on, pressed && styles.pressed]}
    >
      {icon ? <Icon name={icon} size={18} color={fg} /> : null}
      <Text style={[styles.label, { color: fg }]}>{label}</Text>
      {count !== undefined ? (
        <Text style={[styles.label, { color: fg }, tabularNumbers]}>{count}</Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    minHeight: touch.min,
    paddingHorizontal: 16,
    borderRadius: 999,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  on: { backgroundColor: colors.brand700, borderColor: colors.brand700 },
  pressed: { opacity: 0.85 },
  label: { fontSize: 15, fontWeight: "600" },
});
