import { useCallback, useEffect, useState } from "react";
import { Share, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { BigButton } from "@/src/components/BigButton";
import { Money } from "@/src/components/ui/Money";
import { confirm } from "@/src/lib/dialog/store";
import {
  dismissStuckSale,
  listStuckSales,
  retryStuckSale,
  type StuckSale,
} from "@/src/lib/sales/offlineQueue";
import { Text } from "@/src/theme/Text";
import { colors, radius, spacing } from "@/src/theme/tokens";

// The old sell/stuck screen, as a list inside the sync menu: sales the server
// refused, kept on the device with the reason. Owner only.
export function StuckSalesList({
  onRetry,
  onChanged,
}: {
  onRetry: () => Promise<void>;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const [stuck, setStuck] = useState<StuckSale[]>([]);

  const load = useCallback(async () => {
    setStuck(await listStuckSales());
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const retry = async (id: string) => {
    await retryStuckSale(id);
    await onRetry();
    await load();
    onChanged();
  };

  const exportSale = async (entry: StuckSale) => {
    const text = JSON.stringify(
      {
        id: entry.sale.id,
        date: entry.sale.created_at,
        total_MAD: (entry.sale.total_cents / 100).toFixed(2),
        payment: entry.sale.payment_method,
        error: entry.error,
        lines: entry.sale.lines.map((l) => ({
          name: l.name,
          qty: l.quantity,
          unit_price_MAD: (l.unit_price_cents / 100).toFixed(2),
        })),
      },
      null,
      2
    );
    await Share.share({ message: text, title: `Vente ${entry.sale.id.slice(0, 8)}` });
  };

  // Dismissing deletes the sale from the device for good: ask first.
  const dismiss = async (entry: StuckSale) => {
    const ok = await confirm({
      tone: "danger",
      title: t("shell.stuckDismissTitle"),
      message: t("shell.stuckDismissMessage"),
      confirmLabel: t("sell.stuck.dismiss"),
      cancelLabel: t("common.cancel"),
    });
    if (!ok) return;
    await dismissStuckSale(entry.sale.id);
    await load();
    onChanged();
  };

  if (stuck.length === 0) return <Text style={styles.empty}>{t("shell.stuckNone")}</Text>;

  return (
    <View style={styles.list}>
      {stuck.map((entry) => (
        <View key={entry.sale.id} style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.date}>
              {t("shell.stuckDate", { date: new Date(entry.sale.created_at).toLocaleString() })}
            </Text>
            <Money cents={entry.sale.total_cents} size="subtitle" />
          </View>
          <Text style={styles.error} numberOfLines={3}>
            {entry.error}
          </Text>
          <View style={styles.actions}>
            <View style={styles.action}>
              <BigButton label={t("sell.stuck.retry")} onPress={() => retry(entry.sale.id)} />
            </View>
            <View style={styles.action}>
              <BigButton
                label={t("sell.stuck.export")}
                variant="secondary"
                onPress={() => exportSale(entry)}
              />
            </View>
            <View style={styles.action}>
              <BigButton
                label={t("sell.stuck.dismiss")}
                variant="secondary"
                onPress={() => dismiss(entry)}
              />
            </View>
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.s3 },
  empty: { fontSize: 15, color: colors.ink600, paddingVertical: spacing.s2 },
  card: {
    backgroundColor: colors.danger100,
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
  date: { flex: 1, fontSize: 14, color: colors.ink700 },
  error: { fontSize: 14, color: colors.danger700 },
  actions: { flexDirection: "row", gap: spacing.s2 },
  action: { flex: 1 },
});
