import { useMemo, useState } from "react";
import { Modal, Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import { useTranslation } from "react-i18next";

import { Icon } from "@/src/components/ui/Icon";
import {
  addMonths,
  addYears,
  daysInMonth,
  formatLongDate,
  formatShortDate,
  isWithinRange,
  monthGrid,
  monthName,
  parseISODate,
  weekdayNames,
  type YMD,
} from "@/src/lib/text/calendar";
import { Text } from "@/src/theme/Text";
import { colors, radius, spacing, touch } from "@/src/theme/tokens";

// A field that looks like an input and opens a calendar. The value is "" or
// YYYY-MM-DD, always plain text: no time zone ever touches it. `today` is the
// store's day (the caller knows the store's time zone, this component does not).
type Props = {
  value: string;
  onChange: (next: string) => void;
  label: string;
  today: string;
  min?: string;
  max?: string;
  clearable?: boolean;
  invalid?: boolean;
};

const CELL = 44;

export function DateField({ value, onChange, label, today, min, max, clearable, invalid }: Props) {
  const { t, i18n } = useTranslation();
  const language = i18n?.language ?? "fr";
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<{ year: number; month: number }>({ year: 2000, month: 1 });
  const { width } = useWindowDimensions();

  const chosen = parseISODate(value);
  const shown = chosen ? formatShortDate(value, language) : value;

  const openCalendar = () => {
    const start = chosen ?? parseISODate(today) ?? { year: 2000, month: 1, day: 1 };
    setView({ year: start.year, month: start.month });
    setOpen(true);
  };
  const close = () => setOpen(false);
  const pick = (iso: string) => {
    onChange(iso);
    close();
  };

  const grid = useMemo(() => monthGrid(view.year, view.month), [view.year, view.month]);
  const weekdays = useMemo(() => weekdayNames(language), [language]);

  // A month is worth visiting only if some day of it can be picked.
  const reachable = (target: YMD): boolean => {
    const first = `${String(target.year).padStart(4, "0")}-${String(target.month).padStart(2, "0")}`;
    const lastDay = String(daysInMonth(target.year, target.month)).padStart(2, "0");
    if (min && `${first}-${lastDay}` < min) return false;
    if (max && `${first}-01` > max) return false;
    return true;
  };
  const at: YMD = { year: view.year, month: view.month, day: 1 };
  const go = (next: YMD) => setView({ year: next.year, month: next.month });

  const todayOk = parseISODate(today) !== null && isWithinRange(today, min, max);
  const cardWidth = Math.min(360, Math.max(0, width - 32));

  const nav = (next: YMD, pointsBack: boolean, labelKey: string, testID: string) => {
    const enabled = reachable(next);
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t(labelKey)}
        accessibilityState={{ disabled: !enabled }}
        disabled={!enabled}
        onPress={() => go(next)}
        style={[styles.navButton, !enabled && styles.navDisabled]}
        testID={testID}
      >
        {/* The chevron points toward the end edge; the Icon mirrors itself in
            Arabic, so a "back" arrow is mirrored once more by this wrapper. */}
        <View style={pointsBack ? styles.mirror : undefined}>
          <Icon name="chevron" size={22} color={colors.ink900} />
        </View>
      </Pressable>
    );
  };

  return (
    <View style={styles.group}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${chosen ? formatLongDate(value, language) : t("dateField.choose")}`}
        onPress={openCalendar}
        style={[styles.field, invalid && styles.fieldInvalid]}
        testID="date-field"
      >
        <Text style={[styles.fieldText, !shown && styles.placeholder]} numberOfLines={1}>
          {shown || t("dateField.choose")}
        </Text>
        <Icon name="calendar" size={20} color={colors.ink600} />
      </Pressable>

      <Modal transparent visible={open} animationType="fade" onRequestClose={close}>
        <View style={styles.center}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={close}
            accessibilityLabel={t("common.close")}
            testID="date-backdrop"
          />
          <View style={[styles.card, { width: cardWidth }]} accessibilityViewIsModal>
            <Text style={styles.cardTitle}>{label}</Text>

            <View style={styles.navRow}>
              {nav(addYears(at, -1), true, "dateField.previousYear", "prev-year")}
              <Text style={styles.navTitle}>{String(view.year)}</Text>
              {nav(addYears(at, 1), false, "dateField.nextYear", "next-year")}
            </View>
            <View style={styles.navRow}>
              {nav(addMonths(at, -1), true, "dateField.previousMonth", "prev-month")}
              <Text style={styles.navTitle}>{monthName(language, view.month)}</Text>
              {nav(addMonths(at, 1), false, "dateField.nextMonth", "next-month")}
            </View>

            <View style={styles.weekRow}>
              {weekdays.map((name, index) => (
                <View key={index} style={styles.weekCell}>
                  <Text style={styles.weekText}>{name}</Text>
                </View>
              ))}
            </View>
            {grid.map((row, rowIndex) => (
              <View key={rowIndex} style={styles.weekRow}>
                {row.map((cell) => {
                  if (!cell.inMonth) return <View key={cell.iso} style={styles.dayCell} />;
                  const allowed = isWithinRange(cell.iso, min, max);
                  const selected = cell.iso === value;
                  const isToday = cell.iso === today;
                  const spoken = [
                    formatLongDate(cell.iso, language),
                    selected ? t("dateField.selected") : null,
                    allowed ? null : t("dateField.unavailable"),
                  ]
                    .filter(Boolean)
                    .join(", ");
                  return (
                    <Pressable
                      key={cell.iso}
                      accessibilityRole="button"
                      accessibilityLabel={spoken}
                      accessibilityState={{ selected, disabled: !allowed }}
                      disabled={!allowed}
                      onPress={() => pick(cell.iso)}
                      style={[
                        styles.dayCell,
                        styles.dayButton,
                        isToday && styles.dayToday,
                        selected && styles.daySelected,
                        !allowed && styles.dayDisabled,
                      ]}
                      testID={`day-${cell.iso}`}
                    >
                      <Text
                        style={[
                          styles.dayText,
                          selected && styles.dayTextSelected,
                          !allowed && styles.dayTextDisabled,
                        ]}
                      >
                        {String(cell.day)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ))}

            <View style={styles.footer}>
              <Pressable
                accessibilityRole="button"
                disabled={!todayOk}
                onPress={() => pick(today)}
                style={[styles.footerButton, !todayOk && styles.navDisabled]}
                testID="date-today"
              >
                <Text style={styles.footerText}>{t("dateField.today")}</Text>
              </Pressable>
              {clearable && value !== "" ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => pick("")}
                  style={styles.footerButton}
                  testID="date-clear"
                >
                  <Text style={[styles.footerText, styles.clearText]}>{t("dateField.clear")}</Text>
                </Pressable>
              ) : null}
              <Pressable
                accessibilityRole="button"
                onPress={close}
                style={styles.footerButton}
                testID="date-cancel"
              >
                <Text style={styles.footerText}>{t("common.cancel")}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  group: { flex: 1, gap: 6 },
  label: { fontSize: 13, fontWeight: "600", color: colors.ink700 },
  field: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.s2,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.ink400,
    paddingHorizontal: 14,
    backgroundColor: colors.surface,
  },
  fieldInvalid: { borderColor: colors.danger600 },
  fieldText: { flexShrink: 1, fontSize: 16, color: colors.ink900 },
  placeholder: { color: colors.ink600 },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.panel,
    padding: spacing.s3,
    gap: spacing.s1,
  },
  cardTitle: { fontSize: 16, fontWeight: "700", color: colors.ink900, textAlign: "center" },
  navRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  navTitle: { flex: 1, textAlign: "center", fontSize: 17, fontWeight: "700", color: colors.ink900 },
  navButton: {
    width: touch.min,
    height: CELL,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.control,
    backgroundColor: colors.sunken,
  },
  navDisabled: { opacity: 0.35 },
  mirror: { transform: [{ scaleX: -1 }] },
  weekRow: { flexDirection: "row" },
  weekCell: { flex: 1, height: 32, alignItems: "center", justifyContent: "center" },
  weekText: { fontSize: 12, fontWeight: "600", color: colors.ink600 },
  dayCell: { flex: 1, height: CELL },
  dayButton: { alignItems: "center", justifyContent: "center", borderRadius: radius.control },
  dayToday: { borderWidth: 1, borderColor: colors.brand700 },
  daySelected: { backgroundColor: colors.brand700 },
  dayDisabled: { backgroundColor: colors.sunken, opacity: 0.45 },
  dayText: { fontSize: 15, color: colors.ink900 },
  dayTextSelected: { color: colors.white, fontWeight: "700" },
  dayTextDisabled: { color: colors.disabledFg, textDecorationLine: "line-through" },
  footer: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    gap: spacing.s2,
    marginTop: spacing.s2,
  },
  footerButton: {
    minHeight: touch.min,
    minWidth: 88,
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.control,
    backgroundColor: colors.sunken,
    paddingHorizontal: spacing.s3,
  },
  footerText: { fontSize: 15, fontWeight: "600", color: colors.ink900 },
  clearText: { color: colors.danger700 },
});
