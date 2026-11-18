import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View, type LayoutChangeEvent } from "react-native";
import { useTranslation } from "react-i18next";

import { Banner } from "@/src/components/ui/Banner";
import { isNetworkError } from "@/src/lib/errors/userMessage";
import { Badge } from "@/src/components/ui/Badge";
import { Icon, type IconName } from "@/src/components/ui/Icon";
import { useAuth } from "@/src/lib/auth/AuthProvider";
import {
  fetchExpiringBatches,
  fetchLowStockProducts,
  fetchNegativeStockProducts,
} from "@/src/lib/inventory/queries";
import {
  EXPIRING_DEFAULT_DAYS,
  UNKNOWN_BADGE,
  badgeFromSettled,
  gridColumns,
  type CountBadge,
} from "@/src/lib/inventory/stockHome";
import { sampleInvoiceEnabled, sampleInvoiceId } from "@/src/lib/stock/sampleInvoice";
import { Text } from "@/src/theme/Text";
import { colors, radius, spacing, touch } from "@/src/theme/tokens";
import type { Tone } from "@/src/theme/tones";

type Counts = { lowStock: CountBadge; expiring: CountBadge; negativeStock: CountBadge };

export default function StockHomeScreen() {
  const { profile } = useAuth();
  const { t } = useTranslation();
  const isOwner = profile?.role === "owner";
  const [width, setWidth] = useState(0);
  // Every count failed and one of them for lack of a connection: say so, since
  // the cards would otherwise just look unremarkable.
  const [offline, setOffline] = useState(false);
  const [counts, setCounts] = useState<Counts>({
    lowStock: UNKNOWN_BADGE,
    expiring: UNKNOWN_BADGE,
    negativeStock: UNKNOWN_BADGE,
  });

  // Reloaded whenever the screen regains focus, so a count never goes stale
  // after the owner fixed something on a tool screen. Each count stands alone:
  // one failing shows no badge on its card and leaves the others untouched.
  useFocusEffect(
    useCallback(() => {
      if (!isOwner) return;
      let active = true;
      Promise.allSettled([
        fetchLowStockProducts(true).then((rows) => rows.length),
        fetchExpiringBatches(EXPIRING_DEFAULT_DAYS).then((rows) => rows.length),
        fetchNegativeStockProducts().then((rows) => rows.length),
      ]).then(([lowStock, expiring, negativeStock]) => {
        if (!active) return;
        const results = [lowStock, expiring, negativeStock];
        setOffline(
          results.every((result) => result.status === "rejected") &&
            results.some((result) => result.status === "rejected" && isNetworkError(result.reason))
        );
        setCounts({
          lowStock: badgeFromSettled(lowStock),
          expiring: badgeFromSettled(expiring),
          negativeStock: badgeFromSettled(negativeStock),
        });
      });
      return () => {
        active = false;
      };
    }, [isOwner])
  );

  if (profile && !isOwner) {
    return (
      <View style={styles.blocked}>
        <Text style={styles.blockedText}>{t("stockIn.blockedText")}</Text>
      </View>
    );
  }

  const columns = gridColumns(width);
  const cardWidth = columns === 1 ? undefined : Math.floor((width - GAP * (columns - 1)) / columns);
  const onLayout = (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width);

  const main: CardProps[] = [
    {
      icon: "truck",
      title: t("stockIn.home.receive"),
      hint: t("stockIn.home.receiveHint"),
      href: "/(app)/stock-in/receive",
    },
    {
      icon: "scan",
      title: t("invoices.scan"),
      hint: t("stockIn.home.scanHint"),
      href: "/(app)/stock-in/invoice/capture",
    },
    {
      icon: "receipt",
      title: t("invoices.drafts"),
      hint: t("stockIn.home.draftsHint"),
      href: "/(app)/stock-in/invoice",
    },
    {
      icon: "clipboard",
      title: t("stockIn.home.count"),
      hint: t("stockIn.home.countHint"),
      href: "/(app)/stock-in/count",
    },
    {
      icon: "sliders",
      title: t("stockIn.home.adjust"),
      hint: t("stockIn.home.adjustHint"),
      href: "/(app)/stock-in/adjust",
    },
    {
      icon: "clock",
      title: t("stockIn.home.history"),
      hint: t("stockIn.home.historyHint"),
      href: "/(app)/stock-in/history",
    },
  ];
  if (sampleInvoiceEnabled) {
    main.push({
      icon: "book",
      title: t("invoices.title"),
      hint: t("stockIn.home.draftsHint"),
      href: `/(app)/stock-in/invoice/${sampleInvoiceId}`,
    });
  }

  const attention: CardProps[] = [
    {
      icon: "package",
      title: t("stockIn.home.lowStock"),
      hint: t("stockIn.home.lowStockHint"),
      href: "/(app)/stock-in/low-stock",
      badge: counts.lowStock,
      tone: "warn",
    },
    {
      icon: "calendar",
      title: t("stockIn.home.expiring"),
      hint: t("stockIn.home.expiringHint", { days: EXPIRING_DEFAULT_DAYS }),
      href: "/(app)/stock-in/expiring",
      badge: counts.expiring,
      tone: "warn",
    },
    {
      icon: "trendingDown",
      title: t("stockIn.home.negativeStock"),
      hint: t("stockIn.home.negativeStockHint"),
      href: "/(app)/stock-in/negative-stock",
      badge: counts.negativeStock,
      tone: "bad",
    },
  ];

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>{t("stockIn.title")}</Text>
      {offline ? <Banner tone="warn" icon="wifiOff" text={t("errors.countsOffline")} /> : null}

      <Text style={styles.sectionLabel}>{t("stockIn.home.mainTitle")}</Text>
      <View style={styles.grid} onLayout={onLayout}>
        {main.map((card) => (
          <ActionCard key={card.href} {...card} width={cardWidth} />
        ))}
      </View>

      <Text style={styles.sectionLabel}>{t("stockIn.home.attentionTitle")}</Text>
      <View style={styles.grid}>
        {attention.map((card) => (
          <ActionCard key={card.href} {...card} width={cardWidth} />
        ))}
      </View>
    </ScrollView>
  );
}

const GAP = spacing.s3;

type CardProps = {
  icon: IconName;
  title: string;
  hint: string;
  href: string;
  badge?: CountBadge;
  tone?: Tone;
};

function ActionCard({
  icon,
  title,
  hint,
  href,
  badge,
  tone = "warn",
  width,
}: CardProps & { width?: number }) {
  const attention = badge?.kind === "some";
  const accent = attention
    ? tone === "bad"
      ? colors.danger600
      : colors.warning700
    : colors.brand700;
  const label =
    badge?.kind === "some"
      ? `${title}, ${badge.count}`
      : badge?.kind === "zero"
        ? `${title}, 0`
        : title;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => router.push(href as never)}
      style={({ pressed }) => [
        styles.card,
        width !== undefined ? { width } : styles.cardFull,
        attention && { borderColor: accent },
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.iconWrap}>
        <Icon name={icon} size={24} color={accent} />
      </View>
      <View style={styles.cardText}>
        <Text style={styles.cardTitle}>{title}</Text>
        <Text style={styles.cardHint}>{hint}</Text>
      </View>
      {badge?.kind === "some" && <Badge value={badge.count} tone={tone} />}
      {badge?.kind === "zero" && <Badge value={0} tone="ok" />}
      <Icon name="chevron" size={20} color={colors.ink400} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.s5, gap: spacing.s3, paddingBottom: 60 },
  title: { fontSize: 24, fontWeight: "700", color: colors.ink900 },
  sectionLabel: {
    marginTop: spacing.s2,
    fontSize: 14,
    fontWeight: "700",
    color: colors.ink600,
    textTransform: "uppercase",
  },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: GAP },
  card: {
    minHeight: touch.key,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.s3,
    paddingVertical: spacing.s3,
    paddingHorizontal: spacing.s4,
    borderRadius: radius.panel,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  cardFull: { width: "100%" },
  pressed: { opacity: 0.85 },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: radius.control,
    backgroundColor: colors.brand50,
    alignItems: "center",
    justifyContent: "center",
  },
  cardText: { flex: 1, gap: 2 },
  cardTitle: { fontSize: 16, fontWeight: "700", color: colors.ink900 },
  cardHint: { fontSize: 13, color: colors.ink600, lineHeight: 18 },
  blocked: { flex: 1, justifyContent: "center", padding: 32 },
  blockedText: { fontSize: 16, textAlign: "center", color: colors.ink600, lineHeight: 23 },
});
