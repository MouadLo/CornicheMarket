import { useState } from "react";
import { StyleSheet, TextInput, View, type TextInputProps } from "react-native";

import { Text } from "@/src/theme/Text";
import { colors, radius, touch } from "@/src/theme/tokens";
import { tabularNumbers } from "@/src/theme/type";

type Props = Omit<TextInputProps, "style"> & {
  label?: string;
  helper?: string;
  error?: string;
  // "DH", "kg": shown after the value. Numeric fields are end-aligned with tabular figures.
  unit?: string;
  numeric?: boolean;
};

// 56 px input, 10 radius, visible outline (3.2:1), 2 px ring on focus.
export function Field({ label, helper, error, unit, numeric, onFocus, onBlur, ...input }: Props) {
  const [focused, setFocused] = useState(false);
  return (
    <View>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View style={[styles.box, focused && styles.focus, !!error && styles.error]}>
        <TextInput
          {...input}
          keyboardType={numeric ? "decimal-pad" : input.keyboardType}
          placeholderTextColor={colors.ink600}
          accessibilityLabel={input.accessibilityLabel ?? label}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          style={[styles.input, numeric && styles.numeric, numeric && tabularNumbers]}
        />
        {unit ? <Text style={styles.unit}>{unit}</Text> : null}
      </View>
      {error ? (
        <Text style={styles.errorText}>{error}</Text>
      ) : helper ? (
        <Text style={styles.helper}>{helper}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 15, fontWeight: "600", color: colors.ink700, marginBottom: 6 },
  box: {
    minHeight: touch.lg,
    borderRadius: radius.control,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.ink400,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    gap: 8,
  },
  focus: { borderColor: colors.brand600, borderWidth: 2 },
  error: { borderColor: colors.danger600, borderWidth: 2 },
  input: { flex: 1, fontSize: 17, color: colors.ink900, paddingVertical: 10 },
  numeric: { textAlign: "right", writingDirection: "ltr" },
  unit: { fontSize: 15, color: colors.ink600 },
  helper: { fontSize: 15, color: colors.ink600, marginTop: 6 },
  errorText: { fontSize: 15, color: colors.danger600, marginTop: 6 },
});
