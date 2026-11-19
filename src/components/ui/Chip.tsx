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
  // A second piece of text that needs attention, such as money already owed.
  alert?: string;
};

// Filters (not navigation): one or more chips toggled in a row.
export function Chip({ label, selected, onPress, icon, count, alert }: Props) {
  const fg = selected ? colors.white : colors.ink700;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      style={({ pressed }) => [
        styles.chip,
        selected && styles.on,
        pressed && (selected ? styles.pressedOn : styles.pressed),
      ]}
    >
      {/* In the flow of the row, not absolutely placed: it flips with the writing direction. */}
      {selected ? <Icon name="check" size={18} color={fg} /> : null}
      {icon ? <Icon name={icon} size={18} color={fg} /> : null}
      <Text style={[styles.label, styles.text, { color: fg }]}>{label}</Text>
      {alert ? (
        <Text style={[styles.label, styles.text, selected ? { color: fg } : styles.alert]}>
          {alert}
        </Text>
      ) : null}
      {count !== undefined ? (
        <Text style={[styles.label, { color: fg }, tabularNumbers]}>{count}</Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    minHeight: touch.min,
    maxWidth: "100%",
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
  pressed: { backgroundColor: colors.brand100, borderColor: colors.brand600 },
  pressedOn: { backgroundColor: colors.brand800, borderColor: colors.brand800 },
  label: { fontSize: 15, fontWeight: "600" },
  // A long name wraps inside the chip instead of running off a phone screen.
  text: { flexShrink: 1 },
  alert: { color: colors.danger600 },
});
