import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { BigButton } from "@/src/components/BigButton";
import { CreditLimitEditor } from "@/src/components/clients/CreditLimitEditor";
import { CustomerPaymentAction } from "@/src/components/clients/CustomerPaymentAction";
import { Banner } from "@/src/components/ui/Banner";
import { InlineError } from "@/src/components/ui/InlineError";
import { LoadError } from "@/src/components/ui/LoadError";
import { StatusPill } from "@/src/components/ui/StatusPill";
import { useAuth } from "@/src/lib/auth/AuthProvider";
import { errorKey, errorKeyOr } from "@/src/lib/errors/userMessage";
import { formatMAD } from "@/src/lib/money";
import { unitLabel } from "@/src/lib/products/unitLabel";
import { fetchStoreTimezone } from "@/src/lib/reports/queries";
import { DEFAULT_STORE_TIMEZONE } from "@/src/lib/reports/ranges";
import {
  mergeTimeline,
  type LedgerEntry,
  type LedgerPayment,
  type LedgerReturn,
  type LedgerSale,
} from "@/src/lib/sales/creditLedger";
import { DEFAULT_CREDIT_LIMIT_CENTS } from "@/src/lib/sales/creditLimit";
import { saleInstant, storeDayKey } from "@/src/lib/sales/historyView";
import {
  fetchCustomerBalance,
  fetchCustomerCreditReturns,
  fetchCustomerCreditSales,
  fetchCustomerPayments,
  fetchSaleLines,
  fetchStoreCreditLimit,
  recordCustomerPayment,
  updateCustomerCreditLimit,
  type CustomerBalance,
  type CustomerCreditReturn,
  type CustomerCreditSale,
  type SaleLine,
} from "@/src/lib/sales/queries";
import { isolateBidi, isolateLtr } from "@/src/lib/text/bidi";
import { formatLocaleDayHeading, formatLocaleTime } from "@/src/lib/text/dates";
import { Text } from "@/src/theme/Text";
import { colors, radius, touch } from "@/src/theme/tokens";

const PAGE_SIZE = 30;

const toLedgerSale = (sale: CustomerCreditSale): LedgerSale => ({
  kind: "sale",
  id: sale.id,
  instant: saleInstant(sale),
  total_cents: sale.total_cents,
  voided_at: sale.voided_at,
  void_reason: null,
  cashier_name: sale.cashier_name,
  is_own: sale.is_own,
});

const toLedgerReturn = (row: CustomerCreditReturn): LedgerReturn => ({
  kind: "return",
  id: row.id,
  instant: row.created_at,
  refund_cents: row.refund_cents,
  item_count: row.item_count,
});

export default function CustomerHistory() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { profile } = useAuth();
  const { t, i18n } = useTranslation();
  const language = i18n?.language ?? "fr";
  const isOwner = profile?.role === "owner";

  const [balance, setBalance] = useState<CustomerBalance | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [sales, setSales] = useState<LedgerSale[]>([]);
  const [payments, setPayments] = useState<LedgerPayment[]>([]);
  const [returns, setReturns] = useState<LedgerReturn[]>([]);
  const [returnsMore, setReturnsMore] = useState(false);
  const [salesMore, setSalesMore] = useState(false);
  const [paymentsMore, setPaymentsMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [timeZone, setTimeZone] = useState(DEFAULT_STORE_TIMEZONE);
  // The store's default debt limit, for the owner's limit editor.
  const [storeCreditLimit, setStoreCreditLimit] = useState(DEFAULT_CREDIT_LIMIT_CENTS);
  // Translation keys (see errorKey), never the server's text.
  const [error, setError] = useState<string | null>(null);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [linesBySale, setLinesBySale] = useState<Map<string, SaleLine[]>>(new Map());
  const [linesError, setLinesError] = useState(false);

  // Rows already loaded, so a reload keeps every page the cashier opened.
  const counts = useRef({ sales: 0, payments: 0, returns: 0 });
  counts.current = { sales: sales.length, payments: payments.length, returns: returns.length };

  const load = useCallback(() => {
    const salesLimit = Math.max(PAGE_SIZE, counts.current.sales);
    const paymentsLimit = Math.max(PAGE_SIZE, counts.current.payments);
    const returnsLimit = Math.max(PAGE_SIZE, counts.current.returns);
    Promise.resolve(fetchStoreTimezone())
      .then(setTimeZone)
      .catch(() => {});
    if (isOwner) {
      Promise.resolve()
        .then(fetchStoreCreditLimit)
        .then((cents) => typeof cents === "number" && setStoreCreditLimit(cents))
        .catch(() => {});
    }
    Promise.all([
      fetchCustomerBalance(id),
      fetchCustomerCreditSales(id, salesLimit, 0),
      fetchCustomerPayments(id, paymentsLimit, 0),
      fetchCustomerCreditReturns(id, returnsLimit, 0),
    ])
      .then(([row, saleRows, paymentRows, returnRows]) => {
        setBalance(row);
        setSales(saleRows.map(toLedgerSale));
        setPayments(
          paymentRows.map((payment) => ({
            kind: "payment",
            id: payment.id,
            instant: payment.created_at,
            amount_cents: payment.amount_cents,
          }))
        );
        setReturns(returnRows.map(toLedgerReturn));
        setReturnsMore(returnRows.length >= returnsLimit);
        setSalesMore(saleRows.length >= salesLimit);
        setPaymentsMore(paymentRows.length >= paymentsLimit);
        setError(null);
      })
      .catch((failure) => setError(errorKey(failure)))
      .finally(() => setLoaded(true));
  }, [id, isOwner]);

  useFocusEffect(load);

  const retry = () => {
    setLoaded(false);
    load();
  };

  const loadMore = async () => {
    setLoadingMore(true);
    setMoreError(null);
    try {
      const [saleRows, paymentRows, returnRows] = await Promise.all([
        salesMore ? fetchCustomerCreditSales(id, PAGE_SIZE, sales.length) : Promise.resolve([]),
        paymentsMore ? fetchCustomerPayments(id, PAGE_SIZE, payments.length) : Promise.resolve([]),
        returnsMore
          ? fetchCustomerCreditReturns(id, PAGE_SIZE, returns.length)
          : Promise.resolve([]),
      ]);
      setReturns((prev) => [...prev, ...returnRows.map(toLedgerReturn)]);
      setSales((prev) => [...prev, ...saleRows.map(toLedgerSale)]);
      setPayments((prev) => [
        ...prev,
        ...paymentRows.map((payment): LedgerPayment => ({
          kind: "payment",
          id: payment.id,
          instant: payment.created_at,
          amount_cents: payment.amount_cents,
        })),
      ]);
      if (salesMore) setSalesMore(saleRows.length >= PAGE_SIZE);
      if (paymentsMore) setPaymentsMore(paymentRows.length >= PAGE_SIZE);
      if (returnsMore) setReturnsMore(returnRows.length >= PAGE_SIZE);
    } catch (failure) {
      setMoreError(errorKeyOr(failure, "credit.historyLoadError"));
    } finally {
      setLoadingMore(false);
    }
  };

  // The product lines of one sale, fetched the first time it is opened. A
  // cashier goes through the cashier view (fetchSaleLines): no cost column.
  const toggleSale = (saleId: string) => {
    if (openId === saleId) {
      setOpenId(null);
      return;
    }
    setOpenId(saleId);
    if (linesBySale.has(saleId)) return;
    setLinesError(false);
    fetchSaleLines([saleId], isOwner)
      .then((lines) => setLinesBySale((prev) => new Map(prev).set(saleId, lines)))
      .catch(() => setLinesError(true));
  };

  if (!loaded) return <ActivityIndicator style={{ marginTop: 40 }} />;

  if (!balance) {
    return (
      <ScrollView contentContainerStyle={styles.container}>
        {error ? (
          <LoadError title={t("credit.historyLoadError")} reasonKey={error} onRetry={retry} />
        ) : (
          <Text style={styles.empty}>{t("credit.notFound")}</Text>
        )}
      </ScrollView>
    );
  }

  const entries = mergeTimeline(sales, payments, salesMore, paymentsMore, returns, returnsMore);
  const hasMore = salesMore || paymentsMore || returnsMore;
  const owes = balance.balance_cents > 0;

  const days: { key: string; instant: string; entries: LedgerEntry[] }[] = [];
  for (const entry of entries) {
    const key = storeDayKey(entry.instant, timeZone);
    const last = days[days.length - 1];
    if (last && last.key === key) last.entries.push(entry);
    else days.push({ key, instant: entry.instant, entries: [entry] });
  }

  const renderLines = (saleId: string) => {
    const lines = linesBySale.get(saleId);
    if (!lines) {
      return linesError ? (
        <Text style={styles.meta}>{t("credit.linesError")}</Text>
      ) : (
        <ActivityIndicator />
      );
    }
    if (lines.length === 0) return <Text style={styles.meta}>{t("credit.noLines")}</Text>;
    return lines.map((line) => (
      <View key={line.id} style={styles.line}>
        <View style={styles.rowMain}>
          <Text style={styles.lineName}>
            {line.product_name ? isolateBidi(line.product_name) : t("credit.unknownProduct")}
          </Text>
          <Text style={styles.meta}>
            {`${line.quantity} ${line.unit ? unitLabel(line.unit, line.quantity, t) : ""}`.trim()}
          </Text>
        </View>
        <Text style={styles.lineTotal}>{isolateLtr(formatMAD(line.line_total_cents))}</Text>
      </View>
    ));
  };

  const renderEntry = (entry: LedgerEntry) => {
    const time = formatLocaleTime(new Date(entry.instant), language, timeZone);
    if (entry.kind === "payment") {
      return (
        <View key={`p-${entry.id}`} style={styles.row}>
          <View style={styles.rowTop}>
            <View style={styles.rowMain}>
              <Text style={styles.entryTitle}>{t("credit.timelinePayment")}</Text>
              <Text style={styles.meta}>{time}</Text>
            </View>
            <Text style={styles.paymentAmount}>
              {isolateLtr(`+${formatMAD(entry.amount_cents)}`)}
            </Text>
          </View>
        </View>
      );
    }
    if (entry.kind === "return") {
      return (
        <View key={`r-${entry.id}`} style={styles.row}>
          <View style={styles.rowTop}>
            <View style={styles.rowMain}>
              <Text style={styles.entryTitle}>{t("credit.timelineReturn")}</Text>
              <Text style={styles.meta}>{time}</Text>
              <Text style={styles.meta}>
                {t("credit.returnItems", { count: entry.item_count })}
              </Text>
            </View>
            <Text style={styles.paymentAmount}>
              {isolateLtr(`−${formatMAD(entry.refund_cents)}`)}
            </Text>
          </View>
        </View>
      );
    }
    const isOpen = openId === entry.id;
    const voided = entry.voided_at !== null;
    // Product lines: the owner opens every sale, a cashier only their own (RLS
    // hides the lines of other people's sales).
    const canOpen = isOwner || entry.is_own === true;
    const rowTop = (
      <View style={styles.rowTop}>
        <View style={styles.rowMain}>
          <Text style={styles.entryTitle}>{t("credit.timelineSale")}</Text>
          <Text style={styles.meta}>{time}</Text>
          {entry.cashier_name ? (
            <Text style={styles.meta}>
              {t("credit.rungUpBy", { name: isolateBidi(entry.cashier_name) })}
            </Text>
          ) : null}
          {voided ? <StatusPill label={t("credit.voidedTag")} tone="neutral" icon="x" /> : null}
        </View>
        <Text style={[styles.saleAmount, voided && styles.amountVoided]}>
          {isolateLtr(formatMAD(entry.total_cents))}
        </Text>
      </View>
    );
    return (
      <View key={`s-${entry.id}`} style={[styles.row, voided && styles.rowVoided]}>
        {canOpen ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={isOpen ? t("credit.hideLines") : t("credit.showLines")}
            accessibilityState={{ expanded: isOpen }}
            style={styles.rowTap}
            onPress={() => toggleSale(entry.id)}
          >
            {rowTop}
          </Pressable>
        ) : (
          rowTop
        )}
        {canOpen && isOpen ? <View style={styles.lines}>{renderLines(entry.id)}</View> : null}
      </View>
    );
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {error ? (
        <Banner
          tone="warn"
          text={t("credit.refreshFailed")}
          action={{ label: t("common.retry"), onPress: retry }}
        />
      ) : null}

      <View style={styles.summary}>
        <Text style={styles.name}>{isolateBidi(balance.name)}</Text>
        {balance.phone ? <Text style={styles.meta}>{isolateLtr(balance.phone)}</Text> : null}
        {owes ? (
          <>
            <Text style={styles.summaryLabel}>{t("credit.owes")}</Text>
            <Text style={styles.owed}>{isolateLtr(formatMAD(balance.balance_cents))}</Text>
          </>
        ) : (
          <Text style={styles.settled}>
            {balance.balance_cents < 0
              ? t("credit.inCredit", { amount: isolateLtr(formatMAD(-balance.balance_cents)) })
              : t("credit.clear")}
          </Text>
        )}
        <Text style={styles.meta}>
          {t("credit.took")} {isolateLtr(formatMAD(balance.credit_total_cents))} ·{" "}
          {t("credit.paid")} {isolateLtr(formatMAD(balance.paid_total_cents))}
        </Text>
      </View>

      {owes ? (
        <CustomerPaymentAction
          customerId={balance.id}
          balanceCents={balance.balance_cents}
          onRecord={(paymentId, cents) =>
            recordCustomerPayment(paymentId, balance.id, cents, "cash")
          }
          onRecorded={load}
        />
      ) : null}

      {isOwner ? (
        <CreditLimitEditor
          customerId={balance.id}
          overrideCents={balance.credit_limit_override_cents ?? null}
          effectiveCents={balance.credit_limit_cents ?? storeCreditLimit}
          storeDefaultCents={storeCreditLimit}
          onSave={(cents) => updateCustomerCreditLimit(balance.id, cents)}
          onSaved={load}
        />
      ) : null}

      <Text style={styles.sectionLabel}>{t("credit.historySection")}</Text>
      {entries.length === 0 && <Text style={styles.empty}>{t("credit.noHistory")}</Text>}

      {days.map((day) => (
        <View key={day.key} style={styles.day}>
          <Text style={styles.dayTitle}>
            {formatLocaleDayHeading(new Date(day.instant), language, timeZone)}
          </Text>
          {day.entries.map(renderEntry)}
        </View>
      ))}

      {moreError ? <InlineError reasonKey={moreError} /> : null}
      {hasMore && (
        <BigButton
          label={loadingMore ? t("credit.loadingMore") : t("credit.loadMore")}
          variant="secondary"
          onPress={loadMore}
          disabled={loadingMore}
        />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 12, paddingBottom: 48 },
  summary: { backgroundColor: colors.surface, borderRadius: radius.panel, padding: 16, gap: 4 },
  name: { fontSize: 20, fontWeight: "800", color: colors.ink900 },
  summaryLabel: { fontSize: 14, color: colors.ink700, marginTop: 6 },
  // Money owed is the danger colour, as in the list.
  owed: { fontSize: 28, fontWeight: "800", color: colors.danger600 },
  settled: { fontSize: 18, fontWeight: "700", color: colors.ink700, marginTop: 6 },
  sectionLabel: { fontSize: 14, fontWeight: "700", color: colors.ink600, marginTop: 8 },
  day: { gap: 10 },
  dayTitle: { fontSize: 15, fontWeight: "700", color: colors.ink900, textTransform: "capitalize" },
  row: {
    borderWidth: 1,
    borderColor: colors.divider,
    backgroundColor: colors.surface,
    borderRadius: radius.panel,
    padding: 14,
    gap: 10,
  },
  rowVoided: { backgroundColor: colors.sunken },
  rowTap: { minHeight: touch.min, justifyContent: "center" },
  rowTop: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  rowMain: { flex: 1, gap: 3 },
  entryTitle: { fontSize: 15, fontWeight: "600", color: colors.ink900 },
  meta: { fontSize: 13, color: colors.ink600 },
  saleAmount: { fontSize: 17, fontWeight: "700", color: colors.danger600 },
  amountVoided: { textDecorationLine: "line-through", color: colors.ink600 },
  paymentAmount: { fontSize: 17, fontWeight: "700", color: colors.success700 },
  lines: { gap: 8, borderTopWidth: 1, borderTopColor: colors.divider, paddingTop: 10 },
  line: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  lineName: { fontSize: 14, fontWeight: "600", color: colors.ink900 },
  lineTotal: { fontSize: 14, fontWeight: "600", color: colors.ink900 },
  empty: { textAlign: "center", color: colors.ink600, marginVertical: 20 },
});
