import { useTranslation } from "react-i18next";
import { ScrollView, StyleSheet, View } from "react-native";

import { centsToDisplay } from "@/src/lib/money";
import { appDirection } from "@/src/lib/text/bidi";
import { colors } from "@/src/theme/tokens";
import { Text } from "@/src/theme/Text";

export type ChartPoint = {
  key: string;
  label: string;
  value: number;
  secondary?: number;
};

type Props = {
  points: ChartPoint[];
  height?: number;
  secondaryLabel?: string;
  // Width of one column. Wide for names (they wrap to two lines), narrow for hours.
  columnWidth?: number;
};

// Bars built from Views. A charting library would mean an SVG dependency in
// the mobile bundle for what is a handful of rectangles.
export function MiniBarChart({ points, height = 140, secondaryLabel, columnWidth = 84 }: Props) {
  const { t, i18n } = useTranslation();
  // The chart follows the app language, so it starts at the reading edge
  // (the right in Arabic) on web, where only <html dir> is set.
  const dir = appDirection(i18n.language);

  if (points.length === 0) {
    return <Text style={styles.empty}>{t("reports.noDataForRange")}</Text>;
  }

  const max = Math.max(...points.map((point) => Math.max(point.value, point.secondary ?? 0)), 1);

  return (
    <View style={styles.wrapper}>
      {secondaryLabel && (
        <View style={styles.legend}>
          <View style={styles.legendItem}>
            <View style={[styles.swatch, styles.barPrimary]} />
            <Text style={styles.legendText}>{t("reports.metricRevenue")}</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.swatch, styles.barSecondary]} />
            <Text style={styles.legendText}>{secondaryLabel}</Text>
          </View>
        </View>
      )}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ direction: dir }}>
        <View style={[styles.chart, { direction: dir }]}>
          {points.map((point) => (
            <View key={point.key} style={[styles.column, { width: columnWidth }]}>
              <Text style={styles.value}>{centsToDisplay(point.value)}</Text>
              <View style={[styles.barGroup, { height }]}>
                <View
                  style={[
                    styles.bar,
                    styles.barPrimary,
                    { height: Math.max(2, (point.value / max) * height) },
                  ]}
                />
                {point.secondary !== undefined && (
                  <View
                    style={[
                      styles.bar,
                      styles.barSecondary,
                      { height: Math.max(2, (point.secondary / max) * height) },
                    ]}
                  />
                )}
              </View>
              <Text style={styles.label} numberOfLines={2} ellipsizeMode="tail">
                {point.label}
              </Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: 8 },
  legend: { flexDirection: "row", gap: 16 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  swatch: { width: 12, height: 12, borderRadius: 3 },
  legendText: { fontSize: 13, color: colors.ink600 },
  chart: { flexDirection: "row", alignItems: "flex-start", gap: 8, paddingVertical: 6 },
  column: { alignItems: "center", gap: 4 },
  barGroup: { flexDirection: "row", alignItems: "flex-end", gap: 3 },
  bar: { width: 16, borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  barPrimary: { backgroundColor: colors.brand700 },
  barSecondary: { backgroundColor: colors.brand300 },
  value: { fontSize: 13, color: colors.ink600 },
  label: {
    fontSize: 13,
    lineHeight: 17,
    color: colors.ink600,
    textAlign: "center",
    alignSelf: "stretch",
  },
  empty: { color: colors.ink600, fontSize: 14, paddingVertical: 12 },
});
