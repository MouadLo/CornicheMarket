import { StyleSheet, View } from "react-native";

import { Chip } from "@/src/components/ui/Chip";
import { spacing } from "@/src/theme/tokens";

// Picks one option among a few (a category, a sub-category). `value` null =
// no choice made (or the "none" option when one is given).
export function ChoiceChips({
  options,
  value,
  onChange,
}: {
  options: { key: string | null; label: string }[];
  value: string | null;
  onChange: (key: string | null) => void;
}) {
  return (
    <View style={styles.wrap} accessibilityRole="radiogroup">
      {options.map((o) => (
        <Chip
          key={o.key ?? "none"}
          label={o.label}
          selected={o.key === value}
          onPress={() => onChange(o.key)}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.s2 },
});
