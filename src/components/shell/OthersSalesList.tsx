import { useCallback, useEffect, useState } from "react";
import { Share, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { BigButton } from "@/src/components/BigButton";
import { Money } from "@/src/components/ui/Money";
import { confirm, showToast } from "@/src/lib/dialog/store";
import {
  listSalesOfOthers,
  listUnreadableSales,
  type PendingSale,
  type UnreadableSale,
} from "@/src/lib/sales/offlineQueue";
import { fetchCashierNames } from "@/src/lib/sales/queries";
import { recoverQueuedSale } from "@/src/lib/sales/recovery";
import { isolateBidi } from "@/src/lib/text/bidi";
import { Text } from "@/src/theme/Text";
import { colors, radius, spacing } from "@/src/theme/tokens";

// Sales on this device that belong to someone else (or to nobody: legacy sales).
// They are never sent under the wrong account. The owner can recover one: it is
// recorded under the owner, flagged recovered-by-owner, and the original cashier
// is kept in the activity log. Owner only.
export function OthersSalesList({
  userId,
  onChanged,
}: {
  userId: string | null;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const [sales, setSales] = useState<PendingSale[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  // Entries no version could read: kept intact, never sent, exported on request.
  const [unreadable, setUnreadable] = useState<UnreadableSale[]>([]);

  const load = useCallback(async () => {
    const list = await listSalesOfOthers(userId);
    setSales(list);
    setUnreadable(await listUnreadableSales().catch(() => []));
    const ids = [...new Set(list.map((s) => s.cashier_id).filter((id): id is string => !!id))];
    setNames(await fetchCashierNames(ids).catch(() => ({})));
  }, [userId]);
  useEffect(() => {
    void load();
  }, [load]);

  const recover = async (sale: PendingSale) => {
    const who = sale.cashier_id
      ? (names[sale.cashier_id] ?? "?")
      : t("shell.recoverUnknownCashier");
    const ok = await confirm({
      title: t("shell.recoverTitle"),
      message: t("shell.recoverMessage", { name: isolateBidi(who) }),
      confirmLabel: t("shell.recoverConfirm"),
      cancelLabel: t("common.cancel"),
    });
    if (!ok) return;
    setBusy(sale.id);
    try {
      const outcome = await recoverQueuedSale(sale);
      showToast({ text: t(outcome === "recovered" ? "shell.recovered" : "shell.recoverAlready") });
    } catch {
      showToast({ text: t("shell.recoverError"), tone: "info" });
    } finally {
      setBusy(null);
      await load();
      onChanged();
    }
  };

  const exportUnreadable = () =>
    Share.share({
      message: JSON.stringify(
        unreadable.map(({ source, raw }) => ({ source, raw })),
        null,
        2
      ),
      title: "Corniche sales (unreadable)",
    });

  if (sales.length === 0 && unreadable.length === 0) return null;
  return (
    <View style={styles.list}>
      {sales.length > 0 ? (
        <>
          <Text style={styles.title}>{t("shell.othersTitle", { count: sales.length })}</Text>
          <Text style={styles.hint}>{t("shell.othersHint")}</Text>
        </>
      ) : null}
      {sales.map((sale) => (
        <View key={sale.id} style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.who}>
              {sale.cashier_id
                ? isolateBidi(names[sale.cashier_id] ?? "?")
                : t("shell.recoverUnknownCashier")}
            </Text>
            <Money cents={sale.total_cents} size="subtitle" />
          </View>
          <Text style={styles.date}>{new Date(sale.created_at).toLocaleString()}</Text>
          <BigButton
            label={t("shell.recoverButton")}
            variant="secondary"
            disabled={busy === sale.id}
            onPress={() => recover(sale)}
          />
        </View>
      ))}
      {unreadable.length > 0 ? (
        <View style={styles.card}>
          <Text style={styles.title}>
            {t("shell.unreadableTitle", { count: unreadable.length })}
          </Text>
          <Text style={styles.hint}>{t("shell.unreadableHint")}</Text>
          <BigButton
            label={t("shell.unreadableExport")}
            variant="secondary"
            onPress={exportUnreadable}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.s2, marginTop: spacing.s2 },
  title: { fontSize: 15, fontWeight: "700", color: colors.ink700 },
  hint: { fontSize: 14, color: colors.ink600 },
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
  who: { flex: 1, fontSize: 17, fontWeight: "600", color: colors.ink900 },
  date: { fontSize: 14, color: colors.ink600 },
});
