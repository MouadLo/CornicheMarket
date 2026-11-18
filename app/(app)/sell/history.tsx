import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";

import { BigButton } from "@/src/components/BigButton";
import { VoidRequestSheet } from "@/src/components/sell/VoidRequestSheet";
import { StatusPill } from "@/src/components/ui/StatusPill";
import { useAuth } from "@/src/lib/auth/AuthProvider";
import { confirmDestructive } from "@/src/lib/confirmDestructive";
import { formatMAD } from "@/src/lib/money";
import { unitLabel } from "@/src/lib/products/unitLabel";
import { DEFAULT_STORE_TIMEZONE } from "@/src/lib/reports/ranges";
import { fetchStoreTimezone } from "@/src/lib/reports/queries";
import { groupSalesByDay, itemsPreview, saleInstant } from "@/src/lib/sales/historyView";
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
  type MyVoidRequest,
  type VoidReason,
} from "@/src/lib/sales/voidRequests";

const PAGE_SIZE = 50;

export default function SalesHistory() {
  const { profile } = useAuth();
  const { t, i18n } = useTranslation();
  const language = i18n?.language ?? "fr";
  const isOwner = profile?.role === "owner";

  const [sales, setSales] = useState<SaleSummary[]>([]);
  const salesCount = useRef(0);
  salesCount.current = sales.length;
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [timeZone, setTimeZone] = useState(DEFAULT_STORE_TIMEZONE);
  const [linesBySale, setLinesBySale] = useState<Map<string, SaleLine[]>>(new Map());
  const [linesError, setLinesError] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [voidingId, setVoidingId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
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
    fetchRecentSales(Math.max(PAGE_SIZE, salesCount.current), 0)
      .then((page) => {
        setSales(page);
        setHasMore(page.length >= Math.max(PAGE_SIZE, salesCount.current));
        loadLines(page.map((sale) => sale.id));
      })
      .catch((loadError) =>
        setError(loadError instanceof Error ? loadError.message : t("sell.historyLoadError"))
      )
      .finally(() => setLoading(false));
  }, [t, isOwner, loadLines]);

  useEffect(load, [load]);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const page = await fetchRecentSales(PAGE_SIZE, sales.length);
      setSales((prev) => [...prev, ...page]);
      setHasMore(page.length >= PAGE_SIZE);
      loadLines(page.map((sale) => sale.id));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t("sell.historyLoadError"));
    } finally {
      setLoadingMore(false);
    }
  };

  const handleVoid = async (saleId: string) => {
    const sale = sales.find((s) => s.id === saleId);
    if (!sale) return;
    const confirmed = await confirmDestructive(
      t("sell.voidConfirmTitle"),
      voidSaleConfirmMessage(sale.total_cents, t),
      t("sell.voidAndRestore"),
      t("common.cancel")
    );
    if (!confirmed) return;

    setSaving(true);
    setError(null);
    try {
      await voidSale(saleId, reason.trim() || t("sell.voidReason"));
      setVoidingId(null);
      setReason("");
      load();
    } catch (voidError) {
      setError(voidError instanceof Error ? voidError.message : t("sell.historyVoidError"));
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
                  ? ` ${t("sell.historyDiscount", { amount: formatMAD(sale.discount_cents) })}`
                  : ""}
                {sale.voided_at ? ` ${t("sell.historyVoided", { reason: sale.void_reason })}` : ""}
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
                <Text style={styles.preview} numberOfLines={1}>
                  {preview.shown.join(", ")}
                  {preview.more > 0
                    ? ` ${t("sell.historyItemsMore", { count: preview.more })}`
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
                        ? ` · ${t("sell.historyLineDiscount", { amount: formatMAD(line.discount_cents) })}`
                        : ""}
                    </Text>
                  </View>
                  <Text style={styles.lineTotal}>{formatMAD(line.line_total_cents)}</Text>
                </View>
              ))
            )}
          </View>
        ) : null}

        {isOwner &&
          !sale.voided_at &&
          (voidingId === sale.id ? (
            <View style={styles.voidBox}>
              <TextInput
                style={styles.input}
                value={reason}
                onChangeText={setReason}
                placeholder={t("sell.voidReason")}
                autoFocus
              />
              <BigButton
                label={saving ? t("sell.voiding") : t("sell.voidAndRestore")}
                variant="danger"
                onPress={() => handleVoid(sale.id)}
                disabled={saving}
              />
              <BigButton
                label={t("common.cancel")}
                variant="secondary"
                onPress={() => {
                  setVoidingId(null);
                  setReason("");
                }}
              />
            </View>
          ) : (
            <Pressable style={styles.voidButton} onPress={() => setVoidingId(sale.id)}>
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

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {error && <Text style={styles.error}>{error}</Text>}
      {sales.length === 0 && <Text style={styles.empty}>{t("sell.historyEmpty")}</Text>}

      {groupSalesByDay(sales, timeZone).map((group) => (
        <View key={group.dayKey} style={styles.day}>
          <View style={styles.dayHeader}>
            <Text style={styles.dayTitle}>
              {formatLocaleDayHeading(new Date(group.instant), language, timeZone)}
            </Text>
            <Text style={styles.dayTotal}>
              {t("sell.historyDayTotal", { amount: formatMAD(group.totalCents) })}
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
  dayHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    gap: 12,
    paddingTop: 8,
  },
  dayTitle: { flex: 1, fontSize: 15, fontWeight: "700", textTransform: "capitalize" },
  dayTotal: { fontSize: 15, fontWeight: "700", color: "#1d7a46" },
  rowTap: { minHeight: 48, justifyContent: "center" },
  preview: { fontSize: 13, color: "#444" },
  lines: { gap: 8, borderTopWidth: 1, borderTopColor: "#eee", paddingTop: 10 },
  line: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  lineName: { fontSize: 14, fontWeight: "600" },
  lineTotal: { fontSize: 14, fontWeight: "600" },
  row: { borderWidth: 1, borderColor: "#eee", borderRadius: 12, padding: 14, gap: 10 },
  rowVoided: { backgroundColor: "#fafafa", borderColor: "#e8e8e8" },
  rowTop: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  rowMain: { flex: 1, gap: 3 },
  time: { fontSize: 15, fontWeight: "600" },
  meta: { fontSize: 13, color: "#666", textTransform: "capitalize" },
  total: { fontSize: 17, fontWeight: "700" },
  totalVoided: { textDecorationLine: "line-through", color: "#999" },
  voidButton: {
    minHeight: 48,
    justifyContent: "center",
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: "#fdecea",
    alignItems: "center",
  },
  voidButtonText: { color: "#b3261e", fontWeight: "700", fontSize: 14 },
  voidBox: { gap: 10 },
  input: {
    minHeight: 52,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#ccc",
    paddingHorizontal: 16,
    fontSize: 16,
  },
  empty: { textAlign: "center", color: "#666", marginTop: 32 },
  refusal: { fontSize: 14, color: "#666" },
  error: { color: "#b3261e" },
});
