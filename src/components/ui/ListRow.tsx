import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { Text } from "@/src/theme/Text";
import { colors } from "@/src/theme/tokens";

type Props = {
  title: string;
  subtitle?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  selected?: boolean;
  onPress?: () => void;
};

// A 68 px list row. Selected: brand.50 background and a 4 px bar on the
// start edge. Pass product and customer names through isolateBidi, and phone numbers or
// barcodes through isolateLtr, or Arabic layouts reorder them.
export function ListRow({ title, subtitle, leading, trailing, selected, onPress }: Props) {
  const body = (
    <>
      {selected ? <View style={styles.bar} /> : null}
      {leading}
      <View style={styles.main}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing}
    </>
  );
  const style = [styles.row, selected && styles.selected];
  return onPress ? (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      style={style}
    >
      {body}
    </Pressable>
  ) : (
    <View style={style}>{body}</View>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 68,
    paddingVertical: 8,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  selected: { backgroundColor: colors.brand50 },
  bar: {
    position: "absolute",
    top: 0,
    bottom: 0,
    start: 0,
    width: 4,
    backgroundColor: colors.brand700,
  },
  main: { flex: 1, minWidth: 0 },
  title: { fontSize: 17, fontWeight: "600", color: colors.ink900 },
  subtitle: { fontSize: 15, color: colors.ink600 },
});
