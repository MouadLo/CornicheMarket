import { Pressable, StyleSheet } from "react-native";

import { Icon, type IconName } from "@/src/components/ui/Icon";
import { colors, touch } from "@/src/theme/tokens";

// A round icon-only button (48 px). It must have a label.
export function IconButton({
  icon,
  label,
  onPress,
  disabled,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      <Icon name={icon} size={20} color={colors.ink900} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: touch.min,
    height: touch.min,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.sunken,
  },
  disabled: { opacity: 0.35 },
  pressed: { opacity: 0.7 },
});
