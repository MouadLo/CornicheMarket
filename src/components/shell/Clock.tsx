import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { Text } from "@/src/theme/Text";
import { tabularNumbers } from "@/src/theme/type";

export function formatClock(date: Date): string {
  const two = (n: number) => String(n).padStart(2, "0");
  return `${two(date.getHours())}:${two(date.getMinutes())}`;
}

// Western digits in every language, as on Moroccan price tags.
function formatDate(date: Date, lang: string): string {
  try {
    const locale = lang === "ar" ? "ar-MA-u-nu-latn" : lang;
    return date.toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short" });
  } catch {
    return "";
  }
}

export function Clock({ showDate = true }: { showDate?: boolean }) {
  const { i18n } = useTranslation();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(id);
  }, []);
  return (
    <View style={styles.wrap} accessibilityRole="timer">
      <Text style={[styles.time, tabularNumbers]}>{formatClock(now)}</Text>
      {showDate ? <Text style={styles.date}>{formatDate(now, i18n?.language ?? "fr")}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "flex-end", paddingHorizontal: 6 },
  time: { fontSize: 20, fontWeight: "600", color: "#ffffff", lineHeight: 22 },
  date: { fontSize: 12, color: "#b9d3db" },
});
