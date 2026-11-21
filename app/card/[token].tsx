import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { BigButton } from "@/src/components/BigButton";
import { CardQr } from "@/src/components/loyalty/CardQr";
import { cardUrl } from "@/src/lib/loyalty/card";
import { pointsText, signedPoints, ledgerLabelKey, valueText } from "@/src/lib/loyalty/display";
import { appOrigin } from "@/src/lib/loyalty/origin";
import { DEFAULT_RATES } from "@/src/lib/loyalty/points";
import { fetchPublicCard, type PublicCard } from "@/src/lib/loyalty/queries";
import { DEFAULT_STORE_TIMEZONE } from "@/src/lib/reports/ranges";
import { formatMAD } from "@/src/lib/money";
import { appDirection, isolateBidi, isolateLtr } from "@/src/lib/text/bidi";
import { formatLocaleDate } from "@/src/lib/text/dates";
import { Text } from "@/src/theme/Text";
import { colors, radius } from "@/src/theme/tokens";

type State = "loading" | "ready" | "unknown" | "error";

// The customer's digital card, at /card/<token>. Public: it opens for a visitor
// who is signed out and for staff who are signed in, and shows only what the
// card knows (first name, balance, recent history). The QR holds this page's
// own address, so the shop's scanner reads it and a phone camera opens it.
export default function CardPage() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const { t, i18n } = useTranslation();
  const language = i18n?.language ?? "fr";
  const dir = appDirection(language);
  const textAlign = dir === "rtl" ? "right" : "left";

  const [state, setState] = useState<State>("loading");
  const [card, setCard] = useState<PublicCard | null>(null);

  const load = useCallback(() => {
    if (!token) {
      setState("unknown");
      return;
    }
    setState("loading");
    fetchPublicCard(token)
      .then((found) => {
        setCard(found);
        setState(found ? "ready" : "unknown");
      })
      .catch(() => setState("error"));
  }, [token]);

  useEffect(load, [load]);

  // How points are earned: the shop's own rate, returned with the card.
  const centsPerPoint = card?.centsPerPoint ?? DEFAULT_RATES.centsPerPoint;

  const origin = appOrigin();

  return (
    <ScrollView style={styles.page} contentContainerStyle={[styles.container, { direction: dir }]}>
      <Text style={styles.shop}>Corniche Market</Text>

      {state === "loading" ? <ActivityIndicator style={{ marginTop: 40 }} /> : null}

      {state === "unknown" ? (
        <View style={styles.panel}>
          <Text style={[styles.messageTitle, { textAlign }]}>{t("loyalty.cardUnknownTitle")}</Text>
          <Text style={[styles.text, { textAlign }]}>{t("loyalty.cardUnknownMessage")}</Text>
        </View>
      ) : null}

      {state === "error" ? (
        <View style={styles.panel}>
          <Text style={[styles.messageTitle, { textAlign }]}>{t("loyalty.cardErrorTitle")}</Text>
          <Text style={[styles.text, { textAlign }]}>{t("loyalty.cardErrorMessage")}</Text>
          <BigButton label={t("common.retry")} variant="secondary" onPress={load} />
        </View>
      ) : null}

      {state === "ready" && card ? (
        <>
          {card.firstName ? (
            <Text style={[styles.hello, { textAlign }]}>
              {t("loyalty.cardHello", { name: isolateBidi(card.firstName) })}
            </Text>
          ) : null}

          <View style={styles.balancePanel}>
            <Text style={styles.balanceLabel}>{t("loyalty.cardBalance")}</Text>
            <Text style={styles.balanceValue} testID="card-balance-value">
              {valueText(card.balancePoints, card.pointValueCents)}
            </Text>
            <Text style={styles.balancePoints} testID="card-balance-points">
              {pointsText(t, card.balancePoints)}
            </Text>
          </View>

          <View style={styles.qrPanel}>
            {token && origin ? (
              <CardQr value={cardUrl(origin, token)} label={t("loyalty.cardQrLabel")} />
            ) : null}
            <Text style={styles.qrCaption}>{t("loyalty.cardShowAtCounter")}</Text>
          </View>

          <View style={styles.panel}>
            <Text style={[styles.sectionTitle, { textAlign }]}>{t("loyalty.cardHowTitle")}</Text>
            <Text style={[styles.text, { textAlign }]} testID="card-how">
              {t("loyalty.cardHow", {
                earn: isolateLtr(formatMAD(centsPerPoint)),
                value: isolateLtr(formatMAD(card.pointValueCents * 100)),
              })}
            </Text>
          </View>

          <View style={styles.panel}>
            <Text style={[styles.sectionTitle, { textAlign }]}>{t("loyalty.cardHistory")}</Text>
            {card.history.length === 0 ? (
              <Text style={[styles.text, { textAlign }]}>{t("loyalty.cardHistoryEmpty")}</Text>
            ) : (
              card.history.map((entry, index) => (
                <View key={`${entry.createdAt}-${index}`} style={styles.entry}>
                  <View style={styles.entryMain}>
                    <Text style={[styles.entryLabel, { textAlign }]}>
                      {t(ledgerLabelKey(entry.kind))}
                    </Text>
                    <Text style={[styles.entryDate, { textAlign }]}>
                      {formatLocaleDate(
                        new Date(entry.createdAt),
                        language,
                        DEFAULT_STORE_TIMEZONE
                      )}
                    </Text>
                  </View>
                  <Text style={[styles.entryPoints, entry.points < 0 && styles.entryNegative]}>
                    {signedPoints(entry.points)}
                  </Text>
                </View>
              ))
            )}
          </View>
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.bg },
  container: {
    padding: 20,
    gap: 16,
    paddingBottom: 48,
    width: "100%",
    maxWidth: 440,
    alignSelf: "center",
  },
  shop: {
    fontSize: 22,
    fontWeight: "800",
    color: colors.brand700,
    textAlign: "center",
    marginTop: 8,
  },
  hello: { fontSize: 20, fontWeight: "700", color: colors.ink900 },
  balancePanel: {
    backgroundColor: colors.brand700,
    borderRadius: radius.panel,
    padding: 20,
    alignItems: "center",
    gap: 4,
  },
  balanceLabel: { fontSize: 15, color: colors.onBrandSoft },
  balanceValue: { fontSize: 44, fontWeight: "800", color: colors.white },
  balancePoints: { fontSize: 20, fontWeight: "600", color: colors.onBrandSoft },
  qrPanel: {
    backgroundColor: colors.white,
    borderRadius: radius.panel,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    alignItems: "center",
    gap: 12,
  },
  qrCaption: { fontSize: 18, fontWeight: "700", color: colors.ink900, textAlign: "center" },
  panel: { backgroundColor: colors.surface, borderRadius: radius.panel, padding: 16, gap: 8 },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.ink600,
    textTransform: "uppercase",
  },
  messageTitle: { fontSize: 18, fontWeight: "700", color: colors.ink900 },
  text: { fontSize: 15, lineHeight: 22, color: colors.ink700 },
  entry: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  entryMain: { flex: 1, gap: 2 },
  entryLabel: { fontSize: 15, fontWeight: "600", color: colors.ink900 },
  entryDate: { fontSize: 13, color: colors.ink600 },
  entryPoints: { fontSize: 17, fontWeight: "700", color: colors.success700 },
  entryNegative: { color: colors.danger600 },
});
