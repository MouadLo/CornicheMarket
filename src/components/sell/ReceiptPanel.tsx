import { useEffect, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { BigButton } from "@/src/components/BigButton";
import { Banner } from "@/src/components/ui/Banner";
import { useAuth } from "@/src/lib/auth/AuthProvider";
import { cashierLabelFor, normalizeLanguage } from "@/src/lib/print/jobs";
import { usePhonePrint } from "@/src/lib/print/usePhonePrint";
import { formatMAD } from "@/src/lib/money";
import { unitLabel } from "@/src/lib/products/unitLabel";
import type { PhonePrintState } from "@/src/lib/print/jobs";
import {
  canPrintReceipt,
  canShareReceipt,
  printReceipt,
  shareReceipt,
} from "@/src/lib/sales/printReceipt";
import {
  discountSplit,
  formatReceiptQuantity,
  loyaltyFooterLines,
  RECEIPT_SHOP_TAGLINE,
  receiptDateText,
  receiptToHtml,
  receiptToText,
  refundMethodsText,
  returnDateText,
  type ReceiptLabels,
  type ReceiptModel,
} from "@/src/lib/sales/receipt";
import { isolateBidi, isolateLtr } from "@/src/lib/text/bidi";
import { Text } from "@/src/theme/Text";
import { colors, radius, spacing } from "@/src/theme/tokens";

type Translate = (key: string, options?: Record<string, unknown>) => string;

const REFUND_KEYS = {
  cash: "receipt.refundCash",
  card: "receipt.refundCard",
  credit: "receipt.refundCredit",
} as const;

const PAYMENT_KEYS = {
  cash: "receipt.payCash",
  card: "receipt.payCard",
  credit: "receipt.payCredit",
} as const;

export function receiptLabels(t: Translate, model: ReceiptModel): ReceiptLabels {
  return {
    receipt: t("receipt.title"),
    number: t("receipt.number"),
    cashier: t("receipt.cashier"),
    customer: t("receipt.customer"),
    subtotal: t("receipt.subtotal"),
    discount: t("receipt.discount"),
    total: t("receipt.total"),
    payment: t("receipt.payment"),
    paymentMethod: t(PAYMENT_KEYS[model.paymentMethod]),
    cashReceived: t("receipt.cashReceived"),
    change: t("receipt.change"),
    thanks: t("receipt.thanks"),
    updatedAfterReturn: t("receipt.updatedAfterReturn"),
    returnedOn: (date) => t("receipt.returnedOn", { date }),
    originalTotal: t("receipt.originalTotal"),
    refunded: t("receipt.refunded"),
    refundMethod: (method) => t(REFUND_KEYS[method]),
    allReturned: t("receipt.allReturned"),
    lineDiscount: (amount) => t("receipt.lineDiscount", { amount }),
    loyaltyDiscount: t("receipt.loyaltyDiscount"),
    pointsEarned: (points) => t("receipt.pointsEarned", { points }),
    loyaltyBalance: (value, points) => t("receipt.loyaltyBalance", { value, points }),
    loyaltyPending: t("receipt.loyaltyPending"),
    unit: (unit, quantity) =>
      unitLabel(unit, quantity, (key, options) => t(key, options as Record<string, unknown>)),
  };
}

function sharedBanner(state: PhonePrintState, t: Translate, retry: () => void) {
  switch (state) {
    case "sending":
    case "queued":
      return <Banner tone="info" text={t("receipt.printQueued")} />;
    case "printing":
      return <Banner tone="info" text={t("receipt.printPrinting")} />;
    case "printed":
      return <Banner tone="ok" text={t("receipt.printDone")} />;
    case "failed":
      return (
        <Banner
          tone="bad"
          text={t("receipt.printStationFailed")}
          action={{ label: t("receipt.printRetry"), onPress: retry }}
        />
      );
    case "timeout":
      return (
        <Banner
          tone="warn"
          text={t("receipt.printNoReply")}
          action={{ label: t("receipt.printRetry"), onPress: retry }}
        />
      );
    case "offline":
      return (
        <Banner
          tone="warn"
          text={t("receipt.printOffline")}
          action={{ label: t("receipt.printRetry"), onPress: retry }}
        />
      );
    default:
      return null;
  }
}

// A small preview of the receipt with Print and (where the device can) Share.
// A failure shows a message here and never touches the sale.
export function ReceiptPanel({
  receipt,
  timeZone,
  onClose,
}: {
  receipt: ReceiptModel | null;
  timeZone?: string;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const language = i18n?.language ?? "fr";
  const { profile } = useAuth();
  const [canShare, setCanShare] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    canShareReceipt().then((ok) => {
      if (alive) setCanShare(ok);
    });
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => setError(null), [receipt]);

  const shared = usePhonePrint({
    receipt,
    cashierLabel: cashierLabelFor(profile?.full_name, receipt?.cashierName),
    language: normalizeLanguage(language),
    timeZone,
  });
  const labels = useMemo(() => (receipt ? receiptLabels(t, receipt) : null), [t, receipt]);
  if (!receipt || !labels) return null;
  const options = { language, timeZone };

  const run = async (action: () => Promise<unknown>, failure: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch {
      setError(failure);
    } finally {
      setBusy(false);
    }
  };

  const amountRow = (label: string, value: string, strong = false) => (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, strong && styles.strong]}>{label}</Text>
      <Text style={[styles.rowValue, strong && styles.strong]}>{value}</Text>
    </View>
  );

  return (
    <Modal transparent visible animationType="slide" onRequestClose={onClose}>
      <Pressable
        accessibilityRole="button"
        style={styles.scrim}
        onPress={onClose}
        accessibilityLabel={t("common.close")}
      />
      <View style={styles.sheet} accessibilityViewIsModal>
        <Text style={styles.title}>{t("receipt.title")}</Text>
        <ScrollView style={styles.paperScroll} contentContainerStyle={styles.paper}>
          <Text style={styles.shop}>{receipt.shopName}</Text>
          <Text style={styles.tagline}>{RECEIPT_SHOP_TAGLINE}</Text>
          <Text style={styles.meta}>{receiptDateText(receipt, options)}</Text>
          <Text style={styles.meta}>{`${labels.number} ${receipt.receiptNumber}`}</Text>
          {receipt.afterReturns ? (
            <>
              <Text style={[styles.meta, styles.strong]}>{labels.updatedAfterReturn}</Text>
              <Text style={styles.meta}>
                {labels.returnedOn(isolateLtr(returnDateText(receipt, options)))}
              </Text>
            </>
          ) : null}
          {receipt.cashierName ? (
            <Text style={styles.meta}>
              {`${labels.cashier}: ${isolateBidi(receipt.cashierName)}`}
            </Text>
          ) : null}
          {receipt.customerName ? (
            <Text style={styles.meta}>
              {`${labels.customer}: ${isolateBidi(receipt.customerName)}`}
            </Text>
          ) : null}
          <View style={styles.rule} />
          {receipt.afterReturns && receipt.lines.length === 0 ? (
            <Text style={styles.meta}>{labels.allReturned}</Text>
          ) : null}
          {receipt.lines.map((line, index) => (
            <View key={`${index}-${line.name}`} style={styles.row}>
              <View style={styles.lineMain}>
                <Text style={styles.lineName}>{isolateBidi(line.name)}</Text>
                <Text style={styles.sub}>
                  {`${isolateLtr(
                    `${formatReceiptQuantity(line.quantity)} ${line.unit ? labels.unit(line.unit, line.quantity) : ""}`.trim()
                  )} × ${isolateLtr(formatMAD(line.unitPriceCents))}`}
                </Text>
                {line.discountCents > 0 ? (
                  <Text style={styles.sub}>
                    {labels.lineDiscount(isolateLtr(formatMAD(line.discountCents)))}
                  </Text>
                ) : null}
              </View>
              <Text style={styles.rowValue}>{formatMAD(line.totalCents)}</Text>
            </View>
          ))}
          <View style={styles.rule} />
          {receipt.discountCents > 0 ? (
            <>
              {amountRow(labels.subtotal, formatMAD(receipt.subtotalCents))}
              {discountSplit(receipt).manualCents > 0
                ? amountRow(labels.discount, `-${formatMAD(discountSplit(receipt).manualCents)}`)
                : null}
              {discountSplit(receipt).pointsCents > 0
                ? amountRow(
                    labels.loyaltyDiscount,
                    `-${formatMAD(discountSplit(receipt).pointsCents)}`
                  )
                : null}
            </>
          ) : null}
          {amountRow(labels.total, formatMAD(receipt.totalCents), true)}
          {receipt.afterReturns ? (
            <>
              {amountRow(labels.originalTotal, formatMAD(receipt.afterReturns.originalTotalCents))}
              {amountRow(
                `${labels.refunded} (${refundMethodsText(receipt, labels)})`,
                `-${formatMAD(receipt.afterReturns.refundedCents)}`
              )}
            </>
          ) : null}
          {amountRow(labels.payment, labels.paymentMethod)}
          {receipt.cashReceivedCents !== null && receipt.changeCents !== null ? (
            <>
              {amountRow(labels.cashReceived, formatMAD(receipt.cashReceivedCents))}
              {amountRow(labels.change, formatMAD(receipt.changeCents))}
            </>
          ) : null}
          {loyaltyFooterLines(receipt, labels, isolateLtr).map((line) => (
            <Text key={line} style={styles.meta} testID="receipt-loyalty-line">
              {line}
            </Text>
          ))}
          <Text style={styles.thanks}>{labels.thanks}</Text>
        </ScrollView>
        {error ? <Banner tone="bad" text={error} /> : null}
        <View style={styles.stationLine}>
          <View style={[styles.dot, shared.stationOnline ? styles.dotOnline : styles.dotOffline]} />
          <Text style={styles.stationText}>
            {shared.stationOnline ? t("receipt.stationReady") : t("receipt.stationUnavailable")}
          </Text>
        </View>
        {sharedBanner(shared.state, t, shared.send)}
        <View style={styles.actions}>
          <BigButton
            label={t("receipt.printAtCounter")}
            variant={shared.stationOnline ? "primary" : "secondary"}
            disabled={!shared.stationOnline || shared.busy}
            onPress={shared.send}
          />
          {canPrintReceipt() ? (
            <BigButton
              label={t("receipt.print")}
              variant={shared.stationOnline ? "secondary" : "primary"}
              disabled={busy}
              onPress={() =>
                run(
                  () => printReceipt(receiptToHtml(receipt, labels, options)),
                  t("receipt.printFailed")
                )
              }
            />
          ) : null}
          {canShare ? (
            <BigButton
              label={t("receipt.share")}
              variant="secondary"
              disabled={busy}
              onPress={() =>
                run(
                  () =>
                    shareReceipt({
                      html: receiptToHtml(receipt, labels, options),
                      text: receiptToText(receipt, labels, options),
                      title: `${receipt.shopName} ${receipt.receiptNumber}`,
                    }),
                  t("receipt.shareFailed")
                )
              }
            />
          ) : null}
          <BigButton label={t("common.close")} variant="secondary" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: colors.scrim },
  sheet: {
    maxHeight: "90%",
    gap: spacing.s3,
    padding: spacing.s4,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.panel,
    borderTopRightRadius: radius.panel,
  },
  title: { fontSize: 20, fontWeight: "700", color: colors.ink900 },
  paperScroll: { flexShrink: 1, backgroundColor: colors.sunken, borderRadius: radius.control },
  paper: { padding: spacing.s4, gap: spacing.s2 },
  shop: { fontSize: 18, fontWeight: "700", color: colors.ink900, textAlign: "center" },
  tagline: { fontSize: 14, color: colors.ink700, textAlign: "center" },
  meta: { fontSize: 15, color: colors.ink700, textAlign: "center" },
  rule: { height: 1, backgroundColor: colors.border, marginVertical: spacing.s1 },
  row: { flexDirection: "row", justifyContent: "space-between", gap: spacing.s3 },
  rowLabel: { flex: 1, fontSize: 15, color: colors.ink700 },
  rowValue: { fontSize: 15, fontWeight: "600", color: colors.ink900 },
  strong: { fontSize: 17, fontWeight: "700", color: colors.ink900 },
  lineMain: { flex: 1, gap: 2 },
  lineName: { fontSize: 15, fontWeight: "600", color: colors.ink900 },
  sub: { fontSize: 15, color: colors.ink600 },
  thanks: { fontSize: 15, color: colors.ink700, textAlign: "center", marginTop: spacing.s2 },
  actions: { gap: spacing.s2 },
  stationLine: { flexDirection: "row", alignItems: "center", gap: spacing.s2 },
  stationText: { fontSize: 15, color: colors.ink700 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  dotOnline: { backgroundColor: colors.success700 },
  dotOffline: { backgroundColor: colors.ink600 },
});
