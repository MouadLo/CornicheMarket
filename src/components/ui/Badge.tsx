import { StyleSheet, View } from "react-native";

import { Text } from "@/src/theme/Text";
import { tabularNumbers } from "@/src/theme/type";
import { tones, type Tone } from "@/src/theme/tones";

// Small round count ("5 things need attention"). 24 px, tabular figures.
export function Badge({ value, tone = "brand" }: { value: number | string; tone?: Tone }) {
  const { bg, fg } = tones[tone];
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[styles.text, { color: fg }, tabularNumbers]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    minWidth: 24,
    height: 24,
    paddingHorizontal: 7,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  text: { fontSize: 13, fontWeight: "700" },
});
