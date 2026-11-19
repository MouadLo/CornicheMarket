import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { DateField } from "@/src/components/ui/DateField";
import { BigButton } from "@/src/components/BigButton";
import { ReceiptPanel } from "@/src/components/sell/ReceiptPanel";
import { VoidReasonPicker } from "@/src/components/sell/VoidReasonPicker";
import { VoidRequestSheet } from "@/src/components/sell/VoidRequestSheet";
import { Text } from "@/src/theme/Text";
import { colors } from "@/src/theme/tokens";
import { Banner } from "@/src/components/ui/Banner";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { LoadQueryError } from "@/src/components/ui/LoadQueryError";
import { StatusPill } from "@/src/components/ui/StatusPill";
import { useAuth } from "@/src/lib/auth/AuthProvider";
import { confirmDestructive } from "@/src/lib/confirmDestructive";
import { formatMAD } from "@/src/lib/money";
import { unitLabel } from "@/src/lib/products/unitLabel";
import { DEFAULT_STORE_TIMEZONE } from "@/src/lib/reports/ranges";
import { fetchStoreTimezone } from "@/src/lib/reports/queries";
import {
  groupSalesByDay,
  storeDayKey,
  itemsPreview,
  composeVoidReason,
  saleInstant,
  voidReasonDisplay,
} from "@/src/lib/sales/historyView";
import {
  HISTORY_RANGE_FROM,
  HISTORY_RANGE_TO,
  HISTORY_PICKED,
  dayRangeParams,
  lastInstantOf,
  singleDayOf,
  nonVoidedTotalCents,
  parseHistoryRange,
} from "@/src/lib/sales/historyRange";
import { isolateBidi, isolateLtr } from "@/src/lib/text/bidi";
import {
  canOfferReceipt,
  receiptFromHistorySale,
  type ReceiptModel,
} from "@/src/lib/sales/receipt";
import { paymentMethodKey } from "@/src/lib/sales/paymentMethod";
import {
  fetchRecentSales,
  fetchSaleLines,
  voidSale,
  type SaleLine,
  type SaleSummary,
} from "@/src/lib/sales/queries";
import { formatLocaleDayHeading, formatLocaleTime } from "@/src/lib/text/dates";
import { voidSaleConfirmMessage } from "@/src/lib/sales/voidConfirm";
import {
  describeVoidRequestError,
  fetchMyVoidRequests,
  latestRequestBySale,
  requestVoid,
  voidRequestValid,
  type MyVoidRequest,
  type VoidReason,
} from "@/src/lib/sales/voidRequests";

const PAGE_SIZE = 50;

export default function SalesHistory() {
  const { profile } = useAuth();
  const { t, i18n } = useTranslation();
  const language = i18n?.language ?? "fr";
  const isOwner = profile?.role === "owner";

  // Opened from a report: only the sales of that report's range. Bad or
  // partial params mean no filter at all.
  const params = useLocalSearchParams<{
    rangeFrom?: string;
    rangeTo?: string;
    picked?: string;
  }>();
  const pickedHere = params?.[HISTORY_PICKED] === "1";
  const rangeFromParam = params?.[HISTORY_RANGE_FROM];
  const rangeToParam = params?.[HISTORY_RANGE_TO];
  const range = useMemo(
    () => parseHistoryRange(rangeFromParam, rangeToParam),
    [rangeFromParam, rangeToParam]
  );

  const [sales, setSales] = useState<SaleSummary[]>([]);
  const salesCount = useRef(0);
  salesCount.current = sales.length;
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [timeZone, setTimeZone] = useState(DEFAULT_STORE_TIMEZONE);
  const [linesBySale, setLinesBySale] = useState<Map<string, SaleLine[]>>(new Map());
  const [linesError, setLinesError] = useState(false);
  const [receipt, setReceipt] = useState<ReceiptModel | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState<false | "page" | "more">(false);
  const [voidingId, setVoidingId] = useState<string | null>(null);
  const [reason, setReason] = useState<VoidReason | null>(null);
  const [reasonNote, setReasonNote] = useState("");
  const [saving, setSaving] = useState(false);
  // Shown inside the void box: the page-level error can be scrolled out of view.
  const [voidError, setVoidError] = useState<string | null>(null);
  // Cashier: the sale being asked about, and what the owner has answered so far.
  const [askingId, setAskingId] = useState<string | null>(null);
  const [askError, setAskError] = useState<string | null>(null);
  const [requests, setRequests] = useState<Map<string, MyVoidRequest>>(new Map());

  // Lines for the sales just loaded (one query for the whole page, which also
  // feeds the items preview). A failure only hides the lines, not the list.
  const loadLines = useCallback(
    (ids: string[]) => {
      fetchSaleLines(ids, isOwner)
        .then((lines) => {
          setLinesError(false);
          setLinesBySale((prev) => {
            const next = new Map(prev);
            for (const id of ids) next.set(id, []);
            for (const line of lines) next.get(line.sale_id)?.push(line);
            return next;
          });
        })
        .catch(() => setLinesError(true));
    },
    [isOwner]
  );

  const load = useCallback(() => {
    setLoading(true);
    setLoadFailed(false);
    Promise.resolve(fetchStoreTimezone())
      .then(setTimeZone)
      .catch(() => {});
    // The status badges are a nicety: if they cannot load, the list still shows.
    if (!isOwner) {
      fetchMyVoidRequests()
        .then((list) => setRequests(latestRequestBySale(list)))
        .catch(() => {});
    }
    // A reload after a void keeps every page already loaded.
    fetchRecentSales(Math.max(PAGE_SIZE, salesCount.current), 0, range)
      .then((page) => {
        setSales(page);
        setHasMore(page.length >= Math.max(PAGE_SIZE, salesCount.current));
        loadLines(page.map((sale) => sale.id));
      })
      .catch(() => setLoadFailed("page"))
      .finally(() => setLoading(false));
  }, [isOwner, loadLines, range]);

  useEffect(load, [load]);

  const loadMore = async () => {
    setLoadingMore(true);
    setLoadFailed(false);
    try {
      const page = await fetchRecentSales(PAGE_SIZE, sales.length, range);
      setSales((prev) => [...prev, ...page]);
      setHasMore(page.length >= PAGE_SIZE);
      loadLines(page.map((sale) => sale.id));
    } catch {
      setLoadFailed("more");
    } finally {
      setLoadingMore(false);
    }
  };

  const handleVoid = async (saleId: string) => {
    const sale = sales.find((s) => s.id === saleId);
    if (!sale || !reason || !voidRequestValid(reason, reasonNote)) return;
    const confirmed = await confirmDestructive(
      t("sell.voidConfirmTitle"),
      voidSaleConfirmMessage(sale.total_cents, t),
      t("sell.voidAndRestore"),
      t("common.cancel")
    );
    if (!confirmed) return;

    setSaving(true);
    setVoidError(null);
    try {
      await voidSale(saleId, composeVoidReason(reason, reasonNote));
      setVoidingId(null);
      setReason(null);
      setReasonNote("");
      load();
    } catch (failure) {
      setVoidError(describeVoidRequestError(failure, t));
    } finally {
      setSaving(false);
    }
  };

  const handleAsk = async (saleId: string, reasonCode: VoidReason, note: string) => {
    setSaving(true);
    setAskError(null);
    try {
      await requestVoid(saleId, reasonCode, note);
      setAskingId(null);
      load();
    } catch (askFailure) {
      setAskError(describeVoidRequestError(askFailure, t));
    } finally {
      setSaving(false);
    }
  };

  // Cashier: a status once the owner has been asked, otherwise the ask button.
  const renderAsk = (saleId: string) => {
    const request = requests.get(saleId);
    if (request?.status === "pending") {
      return <StatusPill label={t("sell.voidRequested")} tone="warn" icon="clock" />;
    }
    return (
      <View style={styles.voidBox}>
        {request?.status === "refused" ? (
          <>
            <StatusPill label={t("sell.voidRefused")} tone="bad" icon="x" />
            {request.refusalNote ? (
              <Text style={styles.refusal}>
                {t("sell.voidRefusedNote", { note: request.refusalNote })}
              </Text>
            ) : null}
          </>
        ) : null}
        <Pressable
          accessibilityRole="button"
          style={styles.voidButton}
          onPress={() => {
            setAskError(null);
            setAskingId(saleId);
          }}
        >
          <Text style={styles.voidButtonText}>{t("sell.askVoid")}</Text>
        </Pressable>
      </View>
    );
  };

  const renderSale = (sale: SaleSummary) => {
    const isOpen = openId === sale.id;
    const lines = linesBySale.get(sale.id);
    const preview =
      lines && lines.length > 0
        ? itemsPreview(lines.map((line) => line.product_name ?? t("sell.historyUnknownProduct")))
        : null;
    return (
      <View key={sale.id} style={[styles.row, sale.voided_at ? styles.rowVoided : null]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isOpen ? t("sell.historyClose") : t("sell.historyOpen")}
          accessibilityState={{ expanded: isOpen }}
          onPress={() => setOpenId(isOpen ? null : sale.id)}
          style={styles.rowTap}
        >
          <View style={styles.rowTop}>
            <View style={styles.rowMain}>
              <Text style={styles.time}>
                {formatLocaleTime(new Date(saleInstant(sale)), language, timeZone)}
              </Text>
              <Text style={styles.meta}>
                {t(paymentMethodKey(sale.payment_method))}
                {sale.discount_cents > 0
                  ? ` ${t("sell.historyDiscount", { amount: isolateLtr(formatMAD(sale.discount_cents)) })}`
                  : ""}
                {sale.voided_at
                  ? ` ${t("sell.historyVoided", { reason: voidReasonDisplay(sale.void_reason, t, isolateBidi) })}`
                  : ""}
              </Text>
              {sale.customer_name ? (
                <Text style={styles.meta}>
                  {t("sell.historyCustomer", { name: sale.customer_name })}
                </Text>
              ) : null}
              {isOwner && sale.cashier_name ? (
                <Text style={styles.meta}>
                  {t("sell.historyCashier", { name: sale.cashier_name })}
                </Text>
              ) : null}
              {preview ? (
                <Text
                  style={[
                    styles.preview,
                    // The first product name must not set the line's direction
                    // (an Arabic name pushed a French line to the right).
                    language === "ar"
                      ? { writingDirection: "rtl", textAlign: "right" }
                      : { writingDirection: "ltr", textAlign: "left" },
                  ]}
                  numberOfLines={1}
                >
                  {preview.shown.map((name) => isolateBidi(name)).join(", ")}
                  {preview.more > 0
                    ? ` ${isolateLtr(t("sell.historyItemsMore", { count: preview.more }))}`
                    : ""}
                </Text>
              ) : null}
            </View>
            <Text style={[styles.total, sale.voided_at ? styles.totalVoided : null]}>
              {formatMAD(sale.total_cents)}
            </Text>
          </View>
        </Pressable>

        {isOpen ? (
          <View style={styles.lines}>
            {linesError && !lines ? (
              <Text style={styles.empty}>{t("sell.historyLinesError")}</Text>
            ) : !lines ? (
              <ActivityIndicator />
            ) : lines.length === 0 ? (
              <Text style={styles.empty}>{t("sell.historyNoLines")}</Text>
            ) : (
              lines.map((line) => (
                <View key={line.id} style={styles.line}>
                  <View style={styles.rowMain}>
                    <Text style={styles.lineName}>
                      {line.product_name ?? t("sell.historyUnknownProduct")}
                    </Text>
                    <Text style={styles.meta}>
                      {`${line.quantity} ${line.unit ? unitLabel(line.unit, line.quantity, t) : ""}`.trim()}
                      {line.discount_cents > 0
                        ? ` · ${t("sell.historyLineDiscount", { amount: isolateLtr(formatMAD(line.discount_cents)) })}`
                        : ""}
                    </Text>
                  </View>
                  <Text style={styles.lineTotal}>{formatMAD(line.line_total_cents)}</Text>
                </View>
              ))
            )}
          </View>
        ) : null}

        {isOpen && lines && lines.length > 0 && canOfferReceipt(sale) ? (
          <Pressable
            accessibilityRole="button"
            style={styles.receiptButton}
            onPress={() =>
              setReceipt(receiptFromHistorySale(sale, lines, t("receipt.unknownProduct")))
            }
          >
            <Text style={styles.receiptButtonText}>{t("receipt.action")}</Text>
          </Pressable>
        ) : null}

        {isOwner &&
          !sale.voided_at &&
          (voidingId === sale.id ? (
            <View style={styles.voidBox}>
              <Text style={styles.voidTitle}>{t("sell.voidReasonTitle")}</Text>
              <VoidReasonPicker
                reason={reason}
                note={reasonNote}
                onReason={setReason}
                onNote={setReasonNote}
                noteAlways
              />
              {voidError ? <Text style={styles.error}>{voidError}</Text> : null}
              <BigButton
                label={saving ? t("sell.voiding") : t("sell.voidAndRestore")}
                variant="danger"
                onPress={() => handleVoid(sale.id)}
                disabled={saving || !voidRequestValid(reason, reasonNote)}
              />
              <BigButton
                label={t("common.cancel")}
                variant="secondary"
                onPress={() => {
                  setVoidingId(null);
                  setReason(null);
                  setReasonNote("");
                  setVoidError(null);
                }}
              />
            </View>
          ) : (
            <Pressable
              accessibilityRole="button"
              style={styles.voidButton}
              onPress={() => {
                setReason(null);
                setReasonNote("");
                setVoidError(null);
                setVoidingId(sale.id);
              }}
            >
              <Text style={styles.voidButtonText}>{t("sell.voidRefund")}</Text>
            </Pressable>
          ))}

        {!isOwner && !sale.voided_at && (!sale.cashier_id || sale.cashier_id === profile?.id)
          ? renderAsk(sale.id)
          : null}
      </View>
    );
  };

  if (loading) return <ActivityIndicator style={{ marginTop: 40 }} />;

  if (loadFailed && sales.length === 0) {
    return <LoadQueryError what={t("sell.historyLoadWhat")} onRetry={load} />;
  }

  const today = storeDayKey(new Date().toISOString(), timeZone);
  const pickedDay = singleDayOf(range, timeZone, storeDayKey);
  const goToDay = (day: string) => {
    if (!day) return clearRange();
    const target = dayRangeParams(day, timeZone);
    if (!target) return;
    // Opened from a report: changing the day keeps the way back to it.
    const fromReport = range !== null && !pickedHere;
    router.replace({
      pathname: "/(app)/sell/history",
      params: fromReport ? target : { ...target, [HISTORY_PICKED]: "1" },
    });
  };
  const clearRange = () => router.replace("/(app)/sell/history");
  const firstDay = range ? formatLocaleDayHeading(range.from, language, timeZone) : "";
  const lastDay = range ? formatLocaleDayHeading(lastInstantOf(range), language, timeZone) : "";

  // Shown with no filter, or a one-day filter (a longer report range keeps its
  // own banner and is not replaced by a day picker).
  const dayPicker =
    !range || pickedDay ? (
      <View style={styles.dayPicker}>
        <DateField
          label={t("sell.historyGoToDay")}
          value={pickedDay}
          onChange={goToDay}
          today={today}
          max={today}
          clearable
        />
      </View>
    ) : null;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {!range ? dayPicker : null}
      {range ? (
        <View style={styles.rangeBox}>
          {/* Opened from Reports, another section: the stack has no screen to go back to. */}
          {!pickedHere && (
            <Pressable
              accessibilityRole="button"
              style={styles.backToReport}
              onPress={() => router.navigate("/(app)/reports")}
            >
              <Text style={styles.backToReportText}>{t("sell.historyBackToReport")}</Text>
            </Pressable>
          )}
          {dayPicker}
          <Banner
            tone="info"
            icon="calendar"
            text={
              firstDay === lastDay
                ? t("sell.historyRangeBannerDay", { date: firstDay })
                : t("sell.historyRangeBanner", { from: firstDay, to: lastDay })
            }
            action={{ label: t("sell.historyRangeClear"), onPress: clearRange }}
          />
          {!hasMore ? (
            <Text style={styles.rangeTotal}>
              {t("sell.historyRangeTotal", {
                amount: isolateLtr(formatMAD(nonVoidedTotalCents(sales))),
              })}
            </Text>
          ) : null}
        </View>
      ) : null}
      {loadFailed ? (
        <Banner
          tone="bad"
          text={t("sell.historyLoadError")}
          action={{ label: t("common.retry"), onPress: loadFailed === "more" ? loadMore : load }}
        />
      ) : null}
      {sales.length === 0 && !loadFailed ? (
        <EmptyState
          icon="receipt"
          title={range ? t("sell.historyEmptyRange") : t("sell.historyEmpty")}
          message={range ? t("sell.historyEmptyRangeHint") : undefined}
          action={
            range ? (
              <BigButton
                label={t("sell.historyRangeClear")}
                variant="secondary"
                onPress={clearRange}
              />
            ) : undefined
          }
        />
      ) : null}

      {groupSalesByDay(sales, timeZone).map((group) => (
        <View key={group.dayKey} style={styles.day}>
          <View style={styles.dayHeader}>
            <Text style={styles.dayTitle}>
              {formatLocaleDayHeading(new Date(group.instant), language, timeZone)}
            </Text>
            <Text style={styles.dayTotal}>
              {t("sell.historyDayTotal", { amount: isolateLtr(formatMAD(group.totalCents)) })}
            </Text>
          </View>
          {group.sales.map((sale) => renderSale(sale))}
        </View>
      ))}

      {hasMore && (
        <BigButton
          label={loadingMore ? t("sell.historyLoadingMore") : t("sell.historyMore")}
          variant="secondary"
          onPress={loadMore}
          disabled={loadingMore}
        />
      )}

      <ReceiptPanel receipt={receipt} timeZone={timeZone} onClose={() => setReceipt(null)} />

      {askingId && (
        <VoidRequestSheet
          key={askingId}
          visible
          amountLabel={formatMAD(sales.find((s) => s.id === askingId)?.total_cents ?? 0)}
          saving={saving}
          error={askError}
          onSubmit={(reasonCode, note) => handleAsk(askingId, reasonCode, note)}
          onClose={() => setAskingId(null)}
        />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 10, paddingBottom: 48 },
  day: { gap: 10 },
  rangeBox: { gap: 8 },
  dayPicker: { flexDirection: "row" },
  backToReport: { minHeight: 48, justifyContent: "center", alignSelf: "flex-start" },
  backToReportText: { fontSize: 15, fontWeight: "700", color: colors.brand700 },
  rangeTotal: { fontSize: 15, fontWeight: "700", color: colors.ink700 },
  dayHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    gap: 12,
    paddingTop: 8,
  },
  dayTitle: { flex: 1, fontSize: 15, fontWeight: "700", textTransform: "capitalize" },
  dayTotal: { fontSize: 15, fontWeight: "700", color: colors.success700 },
  rowTap: { minHeight: 48, justifyContent: "center" },
  preview: { fontSize: 15, color: colors.ink700 },
  lines: { gap: 8, borderTopWidth: 1, borderTopColor: colors.divider, paddingTop: 10 },
  line: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  lineName: { fontSize: 14, fontWeight: "600" },
  lineTotal: { fontSize: 14, fontWeight: "600" },
  row: { borderWidth: 1, borderColor: colors.divider, borderRadius: 12, padding: 14, gap: 10 },
  rowVoided: { backgroundColor: colors.sunken, borderColor: colors.divider },
  rowTop: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  rowMain: { flex: 1, gap: 3 },
  time: { fontSize: 15, fontWeight: "600" },
  meta: { fontSize: 15, color: colors.ink600 },
  total: { fontSize: 17, fontWeight: "700" },
  totalVoided: { textDecorationLine: "line-through", color: colors.ink600 },
  voidButton: {
    minHeight: 48,
    justifyContent: "center",
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: colors.danger100,
    alignItems: "center",
  },
  receiptButton: {
    minHeight: 48,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: colors.brand700,
  },
  receiptButtonText: { color: colors.brand700, fontWeight: "700", fontSize: 15 },
  voidButtonText: { color: colors.danger600, fontWeight: "700", fontSize: 14 },
  voidBox: { gap: 10 },
  voidTitle: { fontSize: 15, fontWeight: "700", color: colors.ink700 },
  empty: { textAlign: "center", color: colors.ink600, marginTop: 32 },
  refusal: { fontSize: 15, color: colors.ink600 },
  error: { color: colors.danger600 },
});
