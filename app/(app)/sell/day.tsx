import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";

import { BigButton } from "@/src/components/BigButton";
import { Banner } from "@/src/components/ui/Banner";
import { Card } from "@/src/components/ui/Card";
import { useAuth } from "@/src/lib/auth/AuthProvider";
import { confirmDestructive } from "@/src/lib/confirmDestructive";
import {
  cashDifferenceCents,
  cashierCashCents,
  expectedCashCents,
  shiftDay,
  sumCashiers,
  type CashierDay,
} from "@/src/lib/day/math";
import { closeDay, fetchDaySummary, reopenDay, type DaySummary } from "@/src/lib/day/queries";
import { centsToDisplay, formatMAD, parseMoneyToCents } from "@/src/lib/money";
import { Text } from "@/src/theme/Text";
import { colors, radius } from "@/src/theme/tokens";

// The cash drawer and the day's figures (UX O2). A cashier sees their own
// totals; the owner sees every cashier, counts the drawer and closes the day,
// which locks it (migration 037).
export default function DayScreen() {
  const { profile } = useAuth();
  const { t } = useTranslation();
  const isOwner = profile?.role === "owner";

  const [day, setDay] = useState<string | null>(null);
  const [summary, setSummary] = useState<DaySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [opening, setOpening] = useState("");
  const [counted, setCounted] = useState("");
  const [leave, setLeave] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const load = useCallback(
    (target: string | null) => {
      setLoading(true);
      setError(null);
      fetchDaySummary(target)
        .then((next) => {
          setSummary(next);
          setDay(next.day);
          setOpening(centsToDisplay(next.suggested_float_cents));
          setCounted("");
          setLeave(null);
          setNote("");
        })
        .catch((e) => setError(e instanceof Error ? e.message : t("day.loadError")))
        .finally(() => setLoading(false));
    },
    [t]
  );

  // The first load asks for the store's own "today": the server answers with
  // it, whatever time zone this device is set to.
  useEffect(() => {
    load(null);
  }, [load]);

  const rows = useMemo(() => summary?.cashiers ?? [], [summary]);
  const total = useMemo(() => sumCashiers(rows), [rows]);

  const openingCents = parseMoneyToCents(opening);
  const countedCents = counted.trim() === "" ? null : parseMoneyToCents(counted);
  const leaveCents = leave === null ? countedCents : parseMoneyToCents(leave);
  const expected = openingCents === null ? null : expectedCashCents(openingCents, rows);
  const difference =
    expected === null || countedCents === null ? null : cashDifferenceCents(countedCents, expected);
  const canClose =
    isOwner &&
    !summary?.closed &&
    openingCents !== null &&
    countedCents !== null &&
    leaveCents !== null &&
    leaveCents <= countedCents;

  const handleClose = async () => {
    if (!day || openingCents === null || countedCents === null || leaveCents === null) return;
    const confirmed = await confirmDestructive(
      t("day.closeConfirmTitle"),
      t("day.closeConfirmMessage", { day }),
      t("day.closeConfirm"),
      t("common.cancel")
    );
    if (!confirmed) return;
    setSaving(true);
    setError(null);
    try {
      await closeDay({
        day,
        openingFloatCents: openingCents,
        countedCashCents: countedCents,
        leaveInDrawerCents: leaveCents,
        note,
      });
      load(day);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("day.closeError"));
    } finally {
      setSaving(false);
    }
  };

  const handleReopen = async () => {
    if (!day) return;
    const confirmed = await confirmDestructive(
      t("day.reopenConfirmTitle"),
      t("day.reopenConfirmMessage"),
      t("day.reopenConfirm"),
      t("common.cancel")
    );
    if (!confirmed) return;
    setSaving(true);
    setError(null);
    try {
      await reopenDay(day);
      load(day);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("day.closeError"));
    } finally {
      setSaving(false);
    }
  };

  const isToday = summary ? day === summary.today : true;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.dayBar}>
        <Pressable
          style={styles.dayButton}
          accessibilityLabel={t("day.previous")}
          onPress={() => day && load(shiftDay(day, -1))}
        >
          <Text style={styles.dayArrow}>‹</Text>
        </Pressable>
        <View style={styles.dayCenter}>
          <Text style={styles.dayText}>{day ?? ""}</Text>
          {summary && (
            <Text style={[styles.status, summary.closed ? styles.statusClosed : styles.statusOpen]}>
              {summary.closed ? t("day.closed") : t("day.open")}
            </Text>
          )}
        </View>
        <Pressable
          style={[styles.dayButton, isToday && styles.dayButtonOff]}
          accessibilityLabel={t("day.next")}
          disabled={isToday}
          onPress={() => day && load(shiftDay(day, 1))}
        >
          <Text style={styles.dayArrow}>›</Text>
        </Pressable>
      </View>

      {loading && <ActivityIndicator />}
      {error && <Text style={styles.error}>{error}</Text>}

      {summary && !loading && (
        <>
          {rows.length === 0 && <Text style={styles.empty}>{t("day.noActivity")}</Text>}

          {rows.map((row) => (
            <CashierCard
              key={row.cashier_id}
              row={row}
              title={isOwner ? row.cashier_name : t("day.yourTotals")}
            />
          ))}

          {isOwner && rows.length > 1 && <CashierCard row={total} title={t("day.allCashiers")} />}

          {isOwner && summary.closed && summary.close && (
            <Card title={t("day.closed")}>
              <Line
                label={t("day.openingFloat")}
                value={formatMAD(summary.close.opening_float_cents)}
              />
              <Line
                label={t("day.expectedCash")}
                value={formatMAD(summary.close.expected_cash_cents)}
              />
              <Line
                label={t("day.countedCash")}
                value={formatMAD(summary.close.counted_cash_cents)}
              />
              <DifferenceLine
                cents={cashDifferenceCents(
                  summary.close.counted_cash_cents,
                  summary.close.expected_cash_cents
                )}
              />
              <Line
                label={t("day.leaveInDrawer")}
                value={formatMAD(summary.close.leave_in_drawer_cents)}
              />
              {summary.close.note ? <Text style={styles.meta}>{summary.close.note}</Text> : null}
              <BigButton
                label={t("day.reopen")}
                variant="secondary"
                onPress={handleReopen}
                disabled={saving}
              />
            </Card>
          )}

          {isOwner && !summary.closed && (
            <Card title={t("day.title")} style={styles.formCard}>
              <Banner tone="info" text={t("day.syncWarning")} />
              <Field label={t("day.openingFloat")} value={opening} onChangeText={setOpening} />
              <Line
                label={t("day.expectedCash")}
                value={expected === null ? "—" : formatMAD(expected)}
                strong
              />
              <Field label={t("day.countedCash")} value={counted} onChangeText={setCounted} />
              {difference !== null && <DifferenceLine cents={difference} />}
              <Field
                label={t("day.leaveInDrawer")}
                value={leave ?? counted}
                onChangeText={setLeave}
              />
              <Field label={t("day.note")} value={note} onChangeText={setNote} text />
              {(openingCents === null || (counted.trim() !== "" && countedCents === null)) && (
                <Text style={styles.error}>{t("day.amountInvalid")}</Text>
              )}
              <BigButton
                label={t("day.closeButton")}
                variant="primary"
                onPress={handleClose}
                disabled={!canClose || saving}
              />
            </Card>
          )}
        </>
      )}
    </ScrollView>
  );
}

function CashierCard({ row, title }: { row: CashierDay; title: string }) {
  const { t } = useTranslation();
  return (
    <Card title={title}>
      <Text style={styles.meta}>{t("day.sales", { count: row.sales_count })}</Text>
      <Line label={t("day.cash")} value={formatMAD(row.cash_cents)} />
      <Line label={t("day.card")} value={formatMAD(row.card_cents)} />
      <Line label={t("day.credit")} value={formatMAD(row.credit_cents)} />
      <Line label={t("day.repayments")} value={formatMAD(row.cash_payments_cents)} />
      <Line label={t("day.discounts")} value={formatMAD(row.discount_cents)} />
      <Line label={t("day.handOver")} value={formatMAD(cashierCashCents(row))} strong />
      {row.voids_count > 0 && (
        <Text style={styles.meta}>
          {t("day.voids", { count: row.voids_count, amount: formatMAD(row.voids_cents) })}
        </Text>
      )}
    </Card>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.line}>
      <Text style={[styles.lineLabel, strong && styles.strong]}>{label}</Text>
      <Text style={[styles.lineValue, strong && styles.strong]}>{value}</Text>
    </View>
  );
}

function DifferenceLine({ cents }: { cents: number }) {
  const { t } = useTranslation();
  const text =
    cents === 0
      ? t("day.differenceOk")
      : cents > 0
        ? t("day.differenceOver", { amount: formatMAD(cents) })
        : t("day.differenceShort", { amount: formatMAD(-cents) });
  return (
    <View style={styles.line}>
      <Text style={styles.lineLabel}>{t("day.difference")}</Text>
      <Text style={[styles.lineValue, cents === 0 ? styles.ok : styles.bad]}>{text}</Text>
    </View>
  );
}

function Field({
  label,
  value,
  onChangeText,
  text,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  text?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.lineLabel}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        keyboardType={text ? "default" : "decimal-pad"}
        placeholder={text ? "" : "0.00"}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    gap: 12,
    paddingBottom: 48,
    maxWidth: 640,
    width: "100%",
    alignSelf: "center",
  },
  formCard: { gap: 8 },
  dayBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  dayButton: { minWidth: 48, minHeight: 48, alignItems: "center", justifyContent: "center" },
  dayButtonOff: { opacity: 0.3 },
  dayArrow: { fontSize: 28, fontWeight: "700" },
  dayCenter: { alignItems: "center", gap: 2 },
  dayText: { fontSize: 18, fontWeight: "700" },
  status: { fontSize: 13, fontWeight: "700" },
  statusOpen: { color: colors.success700 },
  statusClosed: { color: colors.danger700 },
  line: { flexDirection: "row", justifyContent: "space-between", gap: 12, paddingVertical: 4 },
  lineLabel: { fontSize: 15, color: colors.ink700, flexShrink: 1 },
  lineValue: { fontSize: 15, fontWeight: "600" },
  strong: { fontWeight: "800", color: colors.ink900 },
  meta: { fontSize: 15, color: colors.ink600 },
  field: { gap: 4, marginTop: 8 },
  input: {
    minHeight: 48,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.ink400,
    paddingHorizontal: 12,
    fontSize: 16,
  },
  ok: { color: colors.success700 },
  bad: { color: colors.danger700 },
  error: { color: colors.danger600 },
  empty: { textAlign: "center", color: colors.ink600, marginTop: 24 },
});
