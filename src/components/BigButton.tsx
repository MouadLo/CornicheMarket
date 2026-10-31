import { Pressable, StyleSheet, Text } from "react-native";

type Props = {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "danger";
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
    minHeight: 56,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  primary: { backgroundColor: "#1d7a46" },
  secondary: { backgroundColor: "#e8e8e8" },
  danger: { backgroundColor: "#b3261e" },
  // A dimmed button only says "something's off" -- on a bright counter
  // screen the cashier still needs to read why it won't go. Opacity alone
  // put white text at ~2:1 contrast against the pale variant color, well
  // under WCAG's 4.5:1 minimum; this solid pair is 6.3:1 for every variant.
  disabled: { backgroundColor: "#d9d9d9" },
  pressed: { opacity: 0.85 },
  label: { fontSize: 18, fontWeight: "600", color: "#fff" },
  labelSecondary: { color: "#222" },
  labelDisabled: { color: "#4a4a4a" },
});
