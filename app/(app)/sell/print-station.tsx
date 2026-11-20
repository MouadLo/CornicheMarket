import { useCallback, useState } from "react";
import { Platform, ScrollView, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { BigButton } from "@/src/components/BigButton";
import { receiptLabels } from "@/src/components/sell/ReceiptPanel";
import { Banner } from "@/src/components/ui/Banner";
import { Card } from "@/src/components/ui/Card";
import { useScreenWakeLock } from "@/src/lib/device/useScreenWakeLock";
import {
  jobReceiptNumber,
  needsManualAction,
  normalizeLanguage,
  stationStats,
  type PrintJob,
} from "@/src/lib/print/jobs";
import { usePrintStation } from "@/src/lib/print/usePrintStation";
import { printReceipt } from "@/src/lib/sales/printReceipt";
import { RECEIPT_SHOP_NAME, receiptToHtml, type ReceiptModel } from "@/src/lib/sales/receipt";
import { isolateBidi, isolateLtr } from "@/src/lib/text/bidi";
import { formatLocaleDateTime } from "@/src/lib/text/dates";
import { Text } from "@/src/theme/Text";
import { colors, radius, spacing } from "@/src/theme/tokens";

type Translate = (key: string, options?: Record<string, unknown>) => string;

// What the shortcut on the counter PC opens (step 2 of the setup).
const STATION_COMMAND =
  '"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --kiosk-printing --user-data-dir=C:\\CornicheStation --app=https://corniche-market.vercel.app/sell/print-station';

const STATUS_KEYS = {
  pending: "printStation.statusPending",
  printing: "printStation.statusPrinting",
  printed: "printStation.statusPrinted",
  failed: "printStation.statusFailed",
  cancelled: "printStation.statusCancelled",
} as const;

function testReceipt(label: string): ReceiptModel {
  return {
    shopName: RECEIPT_SHOP_NAME,
    receiptNumber: "TEST",
    occurredAt: new Date().toISOString(),
    cashierName: null,
    lines: [
      {
        name: label,
        quantity: 1,
        unit: null,
        unitPriceCents: 1000,
        discountCents: 0,
        totalCents: 1000,
      },
    ],
    subtotalCents: 1000,
    discountCents: 0,
    totalCents: 1000,
    paymentMethod: "cash",
    customerName: null,
    cashReceivedCents: null,
    changeCents: null,
  };
}

// The counter PC's page (web). Signed in and left open, it prints the receipts
// the cashiers send from their phones, one at a time.
export default function PrintStationScreen() {
  const { t, i18n } = useTranslation();
  const isWeb = Platform.OS === "web";
  const language = i18n?.language ?? "fr";
  const [testFailed, setTestFailed] = useState(false);
  const [showSetup, setShowSetup] = useState(false);

  // Each receipt is printed in the language of the phone that sent it.
  const render = useCallback(
    (model: ReceiptModel, job: PrintJob) => {
      const lang = normalizeLanguage(job.language);
      const fixed = i18n.getFixedT(lang) as unknown as Translate;
      return receiptToHtml(model, receiptLabels(fixed, model), {
        language: lang,
        timeZone: job.time_zone ?? undefined,
        banner: job.cashier_label,
        paper: "80mm",
      });
    },
    [i18n]
  );

  const station = usePrintStation({ enabled: isWeb, render });
  const { hidden } = useScreenWakeLock(isWeb);

  if (!isWeb) {
    return (
      <ScrollView contentContainerStyle={styles.container}>
        <Banner tone="info" text={t("printStation.nativeOnly")} />
      </ScrollView>
    );
  }

  const now = Date.now();
  const stats = stationStats(station.jobs, new Date(now));
  const printTest = async () => {
    setTestFailed(false);
    try {
      const model = testReceipt(t("printStation.testLine"));
      const lang = normalizeLanguage(language);
      await printReceipt(
        receiptToHtml(model, receiptLabels(t as unknown as Translate, model), {
          language: lang,
          banner: "TEST",
          paper: "80mm",
        })
      );
    } catch {
      setTestFailed(true);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Card style={styles.header}>
        <Text style={styles.headerTitle}>{t("printStation.active")}</Text>
        <Text style={styles.headerLine}>
          {t("printStation.printedToday", { count: stats.printedToday })}
        </Text>
        <Text style={styles.headerLine}>
          {stats.lastPrintedAt
            ? t("printStation.lastPrint", {
                time: isolateLtr(formatLocaleDateTime(new Date(stats.lastPrintedAt), language)),
              })
            : t("printStation.neverPrinted")}
        </Text>
      </Card>

      {hidden ? <Banner tone="warn" text={t("printStation.keepVisible")} /> : null}
      {!station.connected ? <Banner tone="warn" text={t("printStation.connectionLost")} /> : null}
      {station.actionFailed ? <Banner tone="bad" text={t("printStation.actionFailed")} /> : null}
      {testFailed ? <Banner tone="bad" text={t("printStation.testFailed")} /> : null}

      <BigButton label={t("printStation.testButton")} onPress={printTest} />

      <Text style={styles.sectionLabel}>{t("printStation.recent")}</Text>
      {station.jobs.length === 0 ? (
        <Text style={styles.empty}>{t("printStation.empty")}</Text>
      ) : (
        station.jobs.map((job) => (
          <Card key={job.id} style={styles.job}>
            <View style={styles.jobMain}>
              <Text style={styles.jobName}>{isolateBidi(job.cashier_label)}</Text>
              <Text style={styles.jobMeta}>
                {`${isolateLtr(jobReceiptNumber(job))} · ${isolateLtr(
                  formatLocaleDateTime(new Date(job.created_at), language)
                )}`}
              </Text>
              <Text style={[styles.jobStatus, job.status === "failed" && styles.jobFailed]}>
                {t(STATUS_KEYS[job.status])}
              </Text>
            </View>
            {needsManualAction(job, now) ? (
              <View style={styles.jobActions}>
                <BigButton label={t("printStation.print")} onPress={() => station.printNow(job)} />
                <BigButton
                  label={t("printStation.ignore")}
                  variant="secondary"
                  onPress={() => station.ignore(job)}
                />
              </View>
            ) : null}
          </Card>
        ))
      )}

      <BigButton
        label={t("printStation.setupTitle")}
        variant="secondary"
        onPress={() => setShowSetup((open) => !open)}
      />
      {showSetup ? (
        <Card style={styles.setup}>
          <Text style={styles.step}>{t("printStation.setupStep1")}</Text>
          <Text style={styles.step}>{t("printStation.setupStep2")}</Text>
          <Text selectable style={styles.command}>
            {isolateLtr(STATION_COMMAND)}
          </Text>
          <Text style={styles.step}>{t("printStation.setupStep3")}</Text>
          <Text style={styles.step}>{t("printStation.setupStep4")}</Text>
        </Card>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: spacing.s4,
    gap: spacing.s3,
    paddingBottom: spacing.s7,
    maxWidth: 640,
    width: "100%",
    alignSelf: "center",
  },
  header: { gap: spacing.s1, alignItems: "center" },
  headerTitle: { fontSize: 24, fontWeight: "800", color: colors.success700 },
  headerLine: { fontSize: 16, color: colors.ink700 },
  sectionLabel: { fontSize: 14, fontWeight: "700", color: colors.ink600, marginTop: spacing.s2 },
  empty: { fontSize: 15, color: colors.ink600 },
  job: { gap: spacing.s2 },
  jobMain: { gap: 2 },
  jobName: { fontSize: 17, fontWeight: "700", color: colors.ink900 },
  jobMeta: { fontSize: 14, color: colors.ink600 },
  jobStatus: { fontSize: 14, fontWeight: "700", color: colors.ink700 },
  jobFailed: { color: colors.danger700 },
  jobActions: { gap: spacing.s2 },
  setup: { gap: spacing.s2 },
  step: { fontSize: 15, color: colors.ink700 },
  command: {
    fontSize: 13,
    fontFamily: Platform.select({ web: "monospace", default: undefined }),
    backgroundColor: colors.sunken,
    borderRadius: radius.control,
    padding: spacing.s2,
    color: colors.ink900,
  },
});
