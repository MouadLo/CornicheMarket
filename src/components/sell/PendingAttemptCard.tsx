import { StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { BigButton } from "@/src/components/BigButton";
import { formatMAD } from "@/src/lib/money";
import type { PendingSale } from "@/src/lib/sales/offlineQueue";
import { paymentMethodKey } from "@/src/lib/sales/paymentMethod";
import { Text } from "@/src/theme/Text";
import { colors, radius, spacing } from "@/src/theme/tokens";

// A sale the cashier tried to record whose result is not known: saving it failed
// (or its acknowledgement was lost) and the basket has since changed. It says
// what the attempt was and gives the three ways forward, so the cashier is never
// stuck: retry the very same sale, check the history, or discard it.
export function PendingAttemptCard({
  sale,
  busy,
  error,
  onRetry,
  onHistory,
  onDiscard,
}: {
  sale: PendingSale;
  busy: boolean;
  error: string | null;
  onRetry: () => void;
  onHistory: () => void;
  onDiscard: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.card} accessibilityRole="alert">
      <Text style={styles.title}>{t("sell.attempt.title")}</Text>
      <Text style={styles.summary}>
        {t("sell.attempt.summary", {
          amount: formatMAD(sale.total_cents),
          method: t(paymentMethodKey(sale.payment_method)),
        })}
      </Text>
      <Text style={styles.hint}>{t("sell.attempt.hint")}</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <BigButton
        label={t("sell.attempt.retry")}
        variant="primary"
        disabled={busy}
        onPress={onRetry}
      />
      <BigButton label={t("sell.attempt.history")} variant="secondary" onPress={onHistory} />
      <BigButton
        label={t("sell.attempt.discard")}
        variant="danger"
        disabled={busy}
        onPress={onDiscard}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    margin: spacing.s3,
    padding: spacing.s4,
    gap: spacing.s2,
    borderRadius: radius.control,
    backgroundColor: colors.warning100,
  },
  title: { fontSize: 17, fontWeight: "700", color: colors.warning700 },
  summary: { fontSize: 17, fontWeight: "600", color: colors.ink900 },
  hint: { fontSize: 15, color: colors.ink700 },
  error: { fontSize: 14, color: colors.danger700 },
});
