import { StyleSheet, Text, View } from "react-native";

import { centsToDisplay } from "@/src/lib/money";
import type { PricePoint } from "@/src/lib/stock/queries";

const CHART_HEIGHT = 160;
const MIN_BAR_FRACTION = 0.08;

type Props = {
  points: PricePoint[];
  averageCostCents: number | null;
};

// Drawn with plain Views rather than a charting library: a bar per delivery
// is all this needs, and it keeps the mobile bundle free of an SVG dependency.
export function PriceHistoryChart({ points, averageCostCents }: Props) {
  if (points.length === 0) {
    return <Text style={styles.empty}>No deliveries recorded for this product yet.</Text>;
  }

  const costs = points.map((point) => point.unit_cost_cents);
  const max = Math.max(...costs);
  const min = Math.min(...costs);

  return (
    <View style={styles.wrapper}>
      <View style={styles.scaleRow}>
        <Text style={styles.scaleText}>high {centsToDisplay(max)}</Text>
        {averageCostCents !== null && (
          <Text style={styles.scaleText}>avg {centsToDisplay(averageCostCents)}</Text>
        )}
        <Text style={styles.scaleText}>low {centsToDisplay(min)}</Text>
      </View>

      <View style={styles.chart}>
        {points.map((point, index) => {
          // A flat history would otherwise render as zero-height bars.
          const fraction = max === min ? 1 : (point.unit_cost_cents - min) / (max - min);
          const height = CHART_HEIGHT * (MIN_BAR_FRACTION + fraction * (1 - MIN_BAR_FRACTION));
          const previous = index > 0 ? points[index - 1].unit_cost_cents : null;
          const rose = previous !== null && point.unit_cost_cents > previous;
          const fell = previous !== null && point.unit_cost_cents < previous;

          return (
            <View key={point.id} style={styles.barColumn}>
              <Text style={styles.barValue}>{centsToDisplay(point.unit_cost_cents)}</Text>
              <View
                style={[
                  styles.bar,
                  { height },
                  rose && styles.barUp,
                  fell && styles.barDown,
                ]}
              />
              <Text style={styles.barLabel} numberOfLines={1}>
                {new Date(point.created_at).toLocaleDateString(undefined, {
                  day: "2-digit",
                  month: "2-digit",
                })}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: 8 },
  scaleRow: { flexDirection: "row", justifyContent: "space-between" },
  scaleText: { fontSize: 12, color: "#777" },
  chart: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    minHeight: CHART_HEIGHT + 40,
    paddingTop: 8,
  },
  barColumn: { alignItems: "center", gap: 4, flex: 1, maxWidth: 70 },
  barValue: { fontSize: 11, color: "#444" },
  bar: { width: "100%", minWidth: 18, borderRadius: 6, backgroundColor: "#1d7a46" },
  barUp: { backgroundColor: "#b3261e" },
  barDown: { backgroundColor: "#2e7d32" },
  barLabel: { fontSize: 11, color: "#777" },
  empty: { color: "#666", fontSize: 15 },
});
