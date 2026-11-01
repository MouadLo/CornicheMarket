import { Pressable, ScrollView, StyleSheet, View } from "react-native";

import { Text } from "@/src/theme/Text";
import { colors } from "@/src/theme/tokens";
import { Badge } from "./Badge";
import type { Tone } from "@/src/theme/tones";

export type TabItem = { key: string; label: string; badge?: number; badgeTone?: Tone };

// Navigation between sibling views of one section (52 px, brand underline).
export function Tabs({
  items,
  value,
  onChange,
}: {
  items: TabItem[];
  value: string;
  onChange: (key: string) => void;
}) {
  return (
    <View style={styles.bar}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} accessibilityRole="tablist">
        {items.map((item) => {
          const active = item.key === value;
          return (
            <Pressable
              key={item.key}
              onPress={() => onChange(item.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              style={[styles.tab, active && styles.active]}
            >
              <Text style={[styles.label, active && styles.labelActive]}>{item.label}</Text>
              {item.badge ? <Badge value={item.badge} tone={item.badgeTone ?? "warn"} /> : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { borderBottomWidth: 1, borderBottomColor: colors.border },
  tab: {
    minHeight: 52,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderBottomWidth: 3,
    borderBottomColor: "transparent",
  },
  active: { borderBottomColor: colors.brand700 },
  label: { fontSize: 17, fontWeight: "600", color: colors.ink600 },
  labelActive: { color: colors.brand800 },
});
