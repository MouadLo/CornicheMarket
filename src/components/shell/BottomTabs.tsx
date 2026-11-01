import { router } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";

import { Icon } from "@/src/components/ui/Icon";
import { SECTIONS, type SectionId } from "@/src/lib/nav/sections";
import { Text } from "@/src/theme/Text";
import { colors } from "@/src/theme/tokens";

// Bottom tabs for phones (< 900 dp): at most five. The owner's remaining
// sections sit behind "More" (a popover opened by the shell).
export function BottomTabs({
  tabs,
  hasMore,
  active,
  moreActive,
  onMore,
}: {
  tabs: SectionId[];
  hasMore: boolean;
  active: SectionId | "dev" | null;
  moreActive: boolean;
  onMore: () => void;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingBottom: insets.bottom }]} accessibilityRole="tablist">
      {tabs.map((id) => {
        const s = SECTIONS.find((x) => x.id === id)!;
        const on = id === active;
        return (
          <Pressable
            key={id}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={t(s.labelKey)}
            onPress={() => router.navigate(s.route as never)}
            style={styles.item}
          >
            <Icon name={s.icon} size={24} color={on ? colors.brand700 : colors.ink600} />
            <Text style={[styles.label, on && styles.labelOn]} numberOfLines={1}>
              {t(s.labelKey)}
            </Text>
          </Pressable>
        );
      })}
      {hasMore ? (
        <Pressable
          accessibilityRole="tab"
          accessibilityState={{ selected: moreActive }}
          accessibilityLabel={t("shell.more")}
          onPress={onMore}
          style={styles.item}
        >
          <Icon name="more" size={24} color={moreActive ? colors.brand700 : colors.ink600} />
          <Text style={[styles.label, moreActive && styles.labelOn]} numberOfLines={1}>
            {t("shell.more")}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  item: { flex: 1, minHeight: 64, alignItems: "center", justifyContent: "center", gap: 2 },
  label: { fontSize: 12, fontWeight: "600", color: colors.ink600 },
  labelOn: { color: colors.brand800 },
});
