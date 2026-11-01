import { Pressable, StyleSheet } from "react-native";

import { Text } from "@/src/theme/Text";
import { colors, radius, touch } from "@/src/theme/tokens";

type Props = {
  label: string;
  onPress: () => void;
  // "pay" is the one green button: money coming in (Encaisser, complete sale).
  variant?: "primary" | "secondary" | "danger" | "pay";
  disabled?: boolean;
};

export function BigButton({ label, onPress, variant = "primary", disabled }: Props) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.base,
        disabled ? styles.disabled : styles[variant],
        pressed && !disabled && styles.pressed,
      ]}
    >
      <Text
        style={[
          styles.label,
          variant === "secondary" && !disabled && styles.labelSecondary,
          disabled && styles.labelDisabled,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: touch.lg,
    borderRadius: radius.control,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  primary: { backgroundColor: colors.brand700 },
  pay: { backgroundColor: colors.success600 },
  secondary: {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.ink400,
  },
  danger: { backgroundColor: colors.danger600 },
  // Solid, never faded: a dimmed label can't be read on a bright counter
  // screen. disabledFg on disabledBg is 5.5:1 (tests/theme/contrast).
  disabled: { backgroundColor: colors.disabledBg },
  pressed: { opacity: 0.85 },
  label: { fontSize: 18, fontWeight: "600", color: colors.white },
  labelSecondary: { color: colors.ink900 },
  labelDisabled: { color: colors.disabledFg },
});
