import { StyleSheet, View } from "react-native";

import { Text } from "@/src/theme/Text";
import { softTones, type Tone } from "@/src/theme/tones";
import { Icon, type IconName } from "./Icon";

// Always an icon AND a word ("✓ Payée"): colour is never the only signal.
export function StatusPill({ label, tone, icon }: { label: string; tone: Tone; icon: IconName }) {
  const { bg, fg } = softTones[tone];
  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      <Icon name={icon} size={16} color={fg} />
      <Text style={[styles.text, { color: fg }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    height: 28,
    paddingHorizontal: 10,
    borderRadius: 999,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    alignSelf: "flex-start",
  },
  text: { fontSize: 14, fontWeight: "600" },
});
