import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { BigButton } from "@/src/components/BigButton";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { LoadQueryError } from "@/src/components/ui/LoadQueryError";
import { Money } from "@/src/components/ui/Money";
import { Panel } from "@/src/components/ui/Panel";
import {
  dismissReview,
  fetchReviewSales,
  type ReviewItem,
  type ReviewKind,
  type ReviewLine,
} from "@/src/lib/alerts/queries";
import { showToast } from "@/src/lib/dialog/store";
import { formatMADGrouped } from "@/src/lib/money";
import { isolateBidi, isolateLtr } from "@/src/lib/text/bidi";
import { Text } from "@/src/theme/Text";
import { colors, radius, spacing } from "@/src/theme/tokens";

type T = (key: string, options?: Record<string, unknown>) => string;

// One readable sentence per log line. Amounts are left-to-right islands and
// names are isolated, so Arabic and French mix without scrambling.
export function describeReviewLine(line: ReviewLine, t: T): string {
  const m = (cents: number) => isolateLtr(formatMADGrouped(cents));
  switch (line.type) {
    case "price":
      return t(line.stale ? "shell.priceLineStale" : "shell.priceLine", {
        name: isolateBidi(line.name),
        device: m(line.deviceCents),
        expected: m(line.expectedCents),
      });
    case "discount":
      return t("shell.discountLine", {
        name: isolateBidi(line.name),
        discount: m(line.discountCents),
        amount: m(line.amountCents),
        percent: isolateLtr(String(line.percent)),
      });
    case "saleDiscount":
      return t("shell.saleDiscountLine", {
        discount: m(line.discountCents),
        amount: m(line.amountCents),
        percent: isolateLtr(String(line.percent)),
      });
  }
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${two(d.getDate())}/${two(d.getMonth() + 1)} ${two(d.getHours())}:${two(d.getMinutes())}`;
}

// The list the owner works through: each flagged sale with what was odd about
// it, and one button to say "that's fine". Docked beside the page on a laptop,
// full screen on a phone (Panel decides).
export function ReviewPanel({
  kind,
  onClose,
  onChanged,
}: {
  kind: ReviewKind | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const [items, setItems] = useState<ReviewItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!kind) return;
    setFailed(false);
    setItems(null);
    try {
      setItems(await fetchReviewSales(kind));
    } catch {
      setFailed(true);
    }
  }, [kind]);

  useEffect(() => {
    void load();
  }, [load]);

  const dismiss = async (saleId: string) => {
    if (!kind) return;
    setBusy(saleId);
    try {
      await dismissReview(kind, saleId);
      setItems((current) => (current ?? []).filter((i) => i.saleId !== saleId));
      showToast({ text: t("shell.reviewDismissed") });
      onChanged();
    } catch {
      showToast({ text: t("shell.reviewError"), tone: "info" });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Panel
      visible={kind !== null}
      title={kind === "discount" ? t("shell.reviewDiscountTitle") : t("shell.reviewPriceTitle")}
      onClose={onClose}
    >
      {failed ? (
        <LoadQueryError what={t("shell.alertsTitle")} onRetry={load} />
      ) : items === null ? (
        <ActivityIndicator style={styles.loader} />
      ) : items.length === 0 ? (
        <EmptyState icon="check" title={t("shell.reviewEmpty")} />
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {items.map((item) => (
            <View key={item.saleId} style={styles.card}>
              <View style={styles.row}>
                <Text style={styles.when}>
                  {formatWhen(item.occurredAt)}
                  {item.cashierName
                    ? ` · ${t("shell.reviewBy", { name: isolateBidi(item.cashierName) })}`
                    : ""}
                </Text>
                <Money cents={item.totalCents} size="subtitle" />
              </View>
              {item.lines.map((line, i) => (
                <Text key={i} style={styles.line}>
                  {describeReviewLine(line, t)}
                </Text>
              ))}
              <BigButton
                label={t("shell.reviewDismiss")}
                variant="secondary"
                disabled={busy === item.saleId}
                onPress={() => dismiss(item.saleId)}
              />
            </View>
          ))}
        </ScrollView>
      )}
    </Panel>
  );
}

const styles = StyleSheet.create({
  loader: { marginTop: spacing.s6 },
  list: { gap: spacing.s3, paddingBottom: spacing.s5 },
  card: {
    backgroundColor: colors.sunken,
    borderRadius: radius.control,
    padding: spacing.s3,
    gap: spacing.s2,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.s2,
  },
  when: { flex: 1, fontSize: 15, color: colors.ink600 },
  line: { fontSize: 17, color: colors.ink900 },
});
