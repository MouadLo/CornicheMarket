import { StyleSheet, Switch, View } from "react-native";

import { Text } from "@/src/theme/Text";
import { colors, touch } from "@/src/theme/tokens";

// A label with a switch at the end of the line (start/end, so it flips in Arabic).
export function SwitchRow({
  label,
  value,
  onValueChange,
  disabled,
}: {
  label: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        accessibilityLabel={label}
        trackColor={{ true: colors.brand700, false: colors.border }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: touch.min,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  label: { flex: 1, fontSize: 16, color: colors.ink900 },
});
