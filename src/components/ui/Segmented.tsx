import { Pressable, StyleSheet, View } from "react-native";

import { Text } from "@/src/theme/Text";
import { colors, radius, touch } from "@/src/theme/tokens";

// Picks one mode inside a form or panel (Poids | Montant, Actifs | Inactifs).
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { key: T; label: string }[];
  value: T;
  onChange: (key: T) => void;
}) {
  return (
    <View style={styles.track} accessibilityRole="radiogroup">
      {options.map((o) => {
        const on = o.key === value;
        return (
          <Pressable
            key={o.key}
            onPress={() => onChange(o.key)}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            style={[styles.seg, on && styles.on]}
          >
            <Text style={[styles.label, on && styles.labelOn]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: "row",
    backgroundColor: colors.sunken,
    borderRadius: radius.control,
    overflow: "hidden",
  },
  seg: { flex: 1, minHeight: touch.min, alignItems: "center", justifyContent: "center" },
  on: { backgroundColor: colors.brand700 },
  label: { fontSize: 16, fontWeight: "600", color: colors.ink700 },
  labelOn: { color: colors.white },
});
