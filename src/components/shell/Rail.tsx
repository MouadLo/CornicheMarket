import { router } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { Icon } from "@/src/components/ui/Icon";
import type { Section, SectionId } from "@/src/lib/nav/sections";
import { Text } from "@/src/theme/Text";
import { colors } from "@/src/theme/tokens";

export const RAIL_WIDTH = 88;

// Icon rail for laptop and tablet (>= 900 dp). Laid out with start/end only,
// so it sits on the right in Arabic with no extra code.
export function Rail({
  sections,
  active,
}: {
  sections: Section[];
  active: SectionId | "dev" | null;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.rail} accessibilityRole="tablist">
      {sections.map((s) => {
        const on = s.id === active;
        return (
          <Pressable
            key={s.id}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={t(s.labelKey)}
            onPress={() => router.navigate(s.route as never)}
            style={styles.item}
          >
            <View style={[styles.pill, on && styles.pillOn]}>
              <Icon name={s.icon} color={on ? colors.brand700 : colors.ink600} />
            </View>
            <Text style={[styles.label, on && styles.labelOn]} numberOfLines={1}>
              {t(s.labelKey)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  rail: {
    width: RAIL_WIDTH,
    backgroundColor: colors.surface,
    borderEndWidth: 1,
    borderEndColor: colors.divider,
    paddingTop: 6,
  },
  item: { height: 72, alignItems: "center", justifyContent: "center", gap: 4 },
  pill: {
    width: 56,
    height: 32,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  pillOn: { backgroundColor: colors.brand100 },
  label: { fontSize: 13, fontWeight: "600", color: colors.ink600, maxWidth: RAIL_WIDTH - 8 },
  labelOn: { color: colors.brand800 },
});
