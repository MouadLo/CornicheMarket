import { Redirect } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
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

import { MiniBarChart, type ChartPoint } from "@/src/components/reports/MiniBarChart";
import { useAuth } from "@/src/lib/auth/AuthProvider";
import { centsToDisplay, formatMAD, formatMargin } from "@/src/lib/money";
import { exportTablesAsCsv, exportTablesAsPdf, type ReportTable } from "@/src/lib/reports/export";
import {
  fetchByCategory,
  fetchByHour,
  fetchDailyTrend,
  fetchDeadStock,
  fetchInventoryValue,
  fetchProductPerformance,
  fetchSummary,
  type CategoryRow,
  type DailyPoint,
  type DeadStockRow,
  type HourRow,
  type InventoryValue,
  type ProductPerformance,
  type ReportSummary,
} from "@/src/lib/reports/queries";
import { isValidDateInput, resolveRange, type RangeKey } from "@/src/lib/reports/ranges";
import { appDirection, isolateBidi } from "@/src/lib/text/bidi";

const RANGE_KEYS: { key: RangeKey; tKey: string }[] = [
  { key: "today", tKey: "reports.today" },
  { key: "yesterday", tKey: "reports.yesterday" },
  { key: "7d", tKey: "reports.last7days" },
  { key: "month", tKey: "reports.thisMonth" },
  { key: "30d", tKey: "reports.last30days" },
  { key: "custom", tKey: "reports.custom" },
];

export default function ReportsScreen() {
  const { profile } = useAuth();
  const { t } = useTranslation();
  const isOwner = profile?.role === "owner";

  const [rangeKey, setRangeKey] = useState<RangeKey>("today");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const [today, setToday] = useState<ReportSummary | null>(null);
  const [summary, setSummary] = useState<ReportSummary | null>(null);
  const [daily, setDaily] = useState<DailyPoint[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [hours, setHours] = useState<HourRow[]>([]);
  const [products, setProducts] = useState<ProductPerformance[]>([]);
  const [deadStock, setDeadStock] = useState<DeadStockRow[]>([]);
  const [inventory, setInventory] = useState<InventoryValue | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const range = useMemo(
    () =>
      resolveRange(
        rangeKey,
        isValidDateInput(customFrom) ? customFrom : undefined,
        isValidDateInput(customTo) ? customTo : undefined
      ),
    [rangeKey, customFrom, customTo]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const todayRange = resolveRange("today");
      const [
        todaySummary,
        rangeSummary,
        trend,
        byCategory,
        byHour,
        performance,
        dead,
        inventoryValue,
      ] = await Promise.all([
        fetchSummary(todayRange.from, todayRange.to),
        fetchSummary(range.from, range.to),
        fetchDailyTrend(range.from, range.to),
        fetchByCategory(range.from, range.to),
        fetchByHour(range.from, range.to),
        fetchProductPerformance(range.from, range.to),
        fetchDeadStock(30),
        fetchInventoryValue(),
      ]);

      setToday(todaySummary);
      setSummary(rangeSummary);
      setDaily(trend);
      setCategories(byCategory);
      setHours(byHour);
      setProducts(performance);
      setDeadStock(dead);
      setInventory(inventoryValue);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t("reports.loadError"));
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to, t]);

  useEffect(() => {
    if (isOwner) load();
  }, [isOwner, load]);

  if (profile && !isOwner) return <Redirect href="/(app)/sell" />;

  const topByProfit = [...products].sort((a, b) => b.profit_cents - a.profit_cents).slice(0, 20);
  const topByQuantity = [...products].sort((a, b) => b.quantity - a.quantity).slice(0, 20);
  const lowestMargin = [...products]
    .filter((product) => product.margin_percent !== null)
    .sort((a, b) => (a.margin_percent as number) - (b.margin_percent as number))
    .slice(0, 20);

  const buildTables = (): ReportTable[] => [
    {
      title: `Summary (${range.label})`,
      columns: ["Metric", "Value"],
      rows: [
        ["Revenue", centsToDisplay(summary?.revenue_cents ?? 0)],
        ["Cost of goods sold", centsToDisplay(summary?.cogs_cents ?? 0)],
        ["Gross profit", centsToDisplay(summary?.gross_profit_cents ?? 0)],
        ["Margin %", summary?.margin_percent != null ? `${summary.margin_percent}` : "—"],
        ["Transactions", summary?.transaction_count ?? 0],
        ["Average basket", centsToDisplay(summary?.average_basket_cents ?? 0)],
        ["Losses from adjustments", centsToDisplay(summary?.loss_cents ?? 0)],
        ["Inventory at cost", centsToDisplay(inventory?.cost_value_cents ?? 0)],
        ["Inventory at selling price", centsToDisplay(inventory?.retail_value_cents ?? 0)],
      ],
    },
    {
      title: "Daily trend",
      columns: ["Day", "Revenue", "Profit", "Transactions"],
      rows: daily.map((point) => [
        point.day,
        centsToDisplay(point.revenue_cents),
        centsToDisplay(point.profit_cents),
        point.transaction_count,
      ]),
    },
    {
      title: "By category",
      columns: ["Category", "Quantity", "Revenue", "Profit"],
      rows: categories.map((row) => [
        row.category_name,
        row.quantity,
        centsToDisplay(row.revenue_cents),
        centsToDisplay(row.profit_cents),
      ]),
    },
    {
      title: "Top 20 by profit",
      columns: ["Product", "Quantity", "Revenue", "Profit", "Margin %"],
      rows: topByProfit.map((row) => [
        row.product_name,
        row.quantity,
        centsToDisplay(row.revenue_cents),
        centsToDisplay(row.profit_cents),
        row.margin_percent ?? "—",
      ]),
    },
    {
      title: "Top 20 by quantity",
      columns: ["Product", "Quantity", "Revenue", "Profit"],
      rows: topByQuantity.map((row) => [
        row.product_name,
        row.quantity,
        centsToDisplay(row.revenue_cents),
        centsToDisplay(row.profit_cents),
      ]),
    },
    {
      title: "Lowest margin",
      columns: ["Product", "Revenue", "Profit", "Margin %"],
      rows: lowestMargin.map((row) => [
        row.product_name,
        centsToDisplay(row.revenue_cents),
        centsToDisplay(row.profit_cents),
        row.margin_percent ?? "—",
      ]),
    },
    {
      title: "Not sold in 30 days",
      columns: ["Product", "Stock", "Value at cost", "Last sold"],
      rows: deadStock.map((row) => [
        row.product_name,
        row.stock_quantity,
        centsToDisplay(row.stock_value_cents),
        row.last_sold_at ? new Date(row.last_sold_at).toLocaleDateString() : "never",
      ]),
    },
  ];

  const fileStamp = new Date().toISOString().slice(0, 10);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>{t("reports.title")}</Text>

      {today && (
        <View style={styles.todayCard}>
          <Text style={styles.todayLabel}>{t("reports.today")}</Text>
          <View style={styles.todayGrid}>
            <Metric
              label={t("reports.metricRevenue")}
              value={formatMAD(today.revenue_cents)}
              large
            />
            <Metric
              label={t("reports.profit")}
              value={formatMAD(today.gross_profit_cents)}
              large
              accent
            />
            <Metric
              label={t("reports.metricTransactions")}
              value={String(today.transaction_count)}
            />
            <Metric
              label={t("reports.metricAvgBasket")}
              value={formatMAD(today.average_basket_cents)}
            />
          </View>
        </View>
      )}

      <View style={styles.chips}>
        {RANGE_KEYS.map((option) => (
          <Pressable
            key={option.key}
            style={[styles.chip, rangeKey === option.key && styles.chipActive]}
            onPress={() => setRangeKey(option.key)}
          >
            <Text style={[styles.chipText, rangeKey === option.key && styles.chipTextActive]}>
              {t(option.tKey)}
            </Text>
          </Pressable>
        ))}
      </View>

      {rangeKey === "custom" && (
        <View style={styles.customRow}>
          <TextInput
            style={styles.dateInput}
            value={customFrom}
            onChangeText={setCustomFrom}
            placeholder={t("reports.fromDate")}
            autoCapitalize="none"
          />
          <TextInput
            style={styles.dateInput}
            value={customTo}
            onChangeText={setCustomTo}
            placeholder={t("reports.toDate")}
            autoCapitalize="none"
          />
        </View>
      )}

      {error && <Text style={styles.error}>{error}</Text>}
      {loading && <ActivityIndicator style={{ marginVertical: 20 }} />}

      {!loading && summary && (
        <>
          <Section title={t("reports.money", { label: range.label })}>
            <View style={styles.metricGrid}>
              <Metric
                label={t("reports.metricRevenue")}
                value={formatMAD(summary.revenue_cents)}
                large
              />
              <Metric label={t("reports.metricCogs")} value={formatMAD(summary.cogs_cents)} />
              <Metric
                label={t("reports.metricGrossProfit")}
                value={formatMAD(summary.gross_profit_cents)}
                large
                accent
              />
              <Metric
                label={t("reports.metricMargin")}
                value={formatMargin(summary.margin_percent)}
              />
              <Metric
                label={t("reports.metricTransactions")}
                value={String(summary.transaction_count)}
              />
              <Metric
                label={t("reports.metricAvgBasket")}
                value={formatMAD(summary.average_basket_cents)}
              />
              <Metric
                label={t("reports.metricLosses")}
                value={formatMAD(summary.loss_cents)}
                negative={summary.loss_cents > 0}
              />
            </View>
          </Section>

          <Section title={t("reports.dailySales")}>
            <MiniBarChart
              points={daily.map<ChartPoint>((point) => ({
                key: point.day,
                label: point.day.slice(5),
                value: point.revenue_cents,
                secondary: point.profit_cents,
              }))}
              secondaryLabel={t("reports.profit")}
            />
          </Section>

          <Section title={t("reports.byCategory")}>
            <MiniBarChart
              points={categories.map<ChartPoint>((row) => ({
                key: row.category_id ?? row.category_name,
                label: row.category_name.slice(0, 10),
                value: row.revenue_cents,
                secondary: row.profit_cents,
              }))}
              secondaryLabel={t("reports.profit")}
            />
          </Section>

          <Section title={t("reports.byHour")}>
            <MiniBarChart
              points={hours.map<ChartPoint>((row) => ({
                key: String(row.hour),
                label: `${String(row.hour).padStart(2, "0")}h`,
                value: row.revenue_cents,
              }))}
            />
          </Section>

          {inventory && (
            <Section title={t("reports.inventoryValue")}>
              <View style={styles.metricGrid}>
                <Metric
                  label={t("reports.metricAtCost")}
                  value={formatMAD(inventory.cost_value_cents)}
                  large
                />
                <Metric
                  label={t("reports.metricAtSellingPrice")}
                  value={formatMAD(inventory.retail_value_cents)}
                  large
                />
                <Metric
                  label={t("reports.metricPotentialProfit")}
                  value={formatMAD(inventory.potential_profit_cents)}
                  accent
                />
                <Metric
                  label={t("reports.metricProductsInStock")}
                  value={String(inventory.product_count)}
                />
              </View>
            </Section>
          )}

          <Section title={t("reports.top20ByProfit", { count: topByProfit.length })}>
            <ProductTable
              rows={topByProfit}
              valueLabel={t("reports.colProfit")}
              renderValue={(row) => formatMAD(row.profit_cents)}
            />
          </Section>

          <Section title={t("reports.top20ByQuantity", { count: topByQuantity.length })}>
            <ProductTable
              rows={topByQuantity}
              valueLabel={t("reports.colQuantity")}
              renderValue={(row) => `${row.quantity}`}
            />
          </Section>

          <Section title={t("reports.lowestMargin")}>
            <ProductTable
              rows={lowestMargin}
              valueLabel={t("reports.colMargin")}
              renderValue={(row) => formatMargin(row.margin_percent)}
              warnBelowZero
            />
          </Section>

          <Section title={t("reports.deadStock")}>
            {deadStock.length === 0 ? (
              <Text style={styles.empty}>{t("reports.allSoldRecently")}</Text>
            ) : (
              deadStock.slice(0, 20).map((row) => (
                <View key={row.product_id} style={styles.tableRow}>
                  <View style={styles.tableMain}>
                    <Text style={styles.rowName}>{row.product_name}</Text>
                    <Text style={styles.rowMeta}>
                      {row.stock_quantity} {row.unit} ·{" "}
                      {row.last_sold_at
                        ? t("reports.deadStockLastSold", {
                            date: new Date(row.last_sold_at).toLocaleDateString(),
                          })
                        : t("reports.deadStockNeverSold")}
                    </Text>
                  </View>
                  <Text style={styles.rowValue}>{formatMAD(row.stock_value_cents)}</Text>
                </View>
              ))
            )}
          </Section>

          <View style={styles.exportRow}>
            <Pressable
              style={styles.exportButton}
              onPress={() => exportTablesAsCsv(`report-${fileStamp}.csv`, buildTables())}
            >
              <Text style={styles.exportText}>{t("reports.exportCsv")}</Text>
            </Pressable>
            <Pressable
              style={styles.exportButton}
              onPress={() =>
                exportTablesAsPdf(
                  "Corniche Market report",
                  `${range.label} · generated ${new Date().toLocaleString()}`,
                  buildTables()
                )
              }
            >
              <Text style={styles.exportText}>{t("reports.exportPdf")}</Text>
            </Pressable>
          </View>
        </>
      )}
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Metric({
  label,
  value,
  large,
  accent,
  negative,
}: {
  label: string;
  value: string;
  large?: boolean;
  accent?: boolean;
  negative?: boolean;
}) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text
        style={[
          styles.metricValue,
          large && styles.metricValueLarge,
          accent && styles.metricAccent,
          negative && styles.metricNegative,
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

function ProductTable({
  rows,
  renderValue,
  valueLabel,
  warnBelowZero,
}: {
  rows: ProductPerformance[];
  renderValue: (row: ProductPerformance) => string;
  valueLabel: string;
  warnBelowZero?: boolean;
}) {
  const { t, i18n } = useTranslation();
  if (rows.length === 0) {
    return <Text style={styles.empty}>{t("reports.noSales")}</Text>;
  }

  // The row's layout direction follows the APP language, never the
  // content of any one row -- an Arabic product name must not flip a
  // French-locale row (or vice versa). RN's `direction` style property is
  // a real Yoga layout property, honoured on iOS/Android/web alike, unlike
  // relying on global RTL state (which this intentionally overrides per
  // row so every row is internally consistent with the table as a whole).
  const dir = appDirection(i18n.language);
  const textAlign = dir === "rtl" ? "right" : "left";

  return (
    <>
      <View style={[styles.tableHeader, { direction: dir }]}>
        <Text style={[styles.tableHeaderMain, { textAlign }]}>{t("reports.colProduct")}</Text>
        <Text style={[styles.tableHeaderMeta, { textAlign }]}>{t("reports.colQtyRevenue")}</Text>
        <Text style={styles.tableHeaderValue}>{valueLabel}</Text>
      </View>
      {rows.map((row, index) => (
        <View
          key={row.product_id}
          style={[styles.tableRow, { direction: dir }, index % 2 === 1 && styles.tableRowOdd]}
        >
          <View style={styles.tableMain}>
            <Text style={[styles.rowName, { textAlign }]} numberOfLines={1}>
              {isolateBidi(row.product_name)}
            </Text>
            <Text style={[styles.rowMeta, { textAlign }]}>
              {row.quantity} {row.unit} · {formatMAD(row.revenue_cents)}
            </Text>
          </View>
          <Text
            style={[
              styles.rowValue,
              warnBelowZero && (row.margin_percent ?? 0) < 0 && styles.rowValueNegative,
            ]}
          >
            {renderValue(row)}
          </Text>
        </View>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    gap: 16,
    paddingBottom: 56,
    width: "100%",
    maxWidth: 900,
    alignSelf: "center",
  },
  title: { fontSize: 26, fontWeight: "800" },
  todayCard: { backgroundColor: "#f3f7f4", borderRadius: 14, padding: 16, gap: 10 },
  todayLabel: { fontSize: 13, fontWeight: "700", color: "#1d7a46", textTransform: "uppercase" },
  todayGrid: { flexDirection: "row", flexWrap: "wrap", gap: 14 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 20, backgroundColor: "#eee" },
  chipActive: { backgroundColor: "#1d7a46" },
  chipText: { fontSize: 14, color: "#333" },
  chipTextActive: { color: "#fff", fontWeight: "600" },
  customRow: { flexDirection: "row", gap: 10 },
  dateInput: {
    flex: 1,
    minHeight: 48,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#ccc",
    paddingHorizontal: 14,
    fontSize: 15,
  },
  section: { gap: 10 },
  sectionTitle: { fontSize: 15, fontWeight: "700", color: "#444", textTransform: "uppercase" },
  metricGrid: { flexDirection: "row", flexWrap: "wrap", gap: 14 },
  metric: { minWidth: 120, flexGrow: 1, gap: 3 },
  metricLabel: { fontSize: 12, color: "#666", textTransform: "uppercase" },
  metricValue: { fontSize: 18, fontWeight: "700" },
  metricValueLarge: { fontSize: 24, fontWeight: "800" },
  metricAccent: { color: "#1d7a46" },
  metricNegative: { color: "#b3261e" },
  tableHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 6,
    paddingHorizontal: 8,
    gap: 12,
  },
  tableHeaderMain: {
    flex: 1,
    fontSize: 11,
    fontWeight: "700",
    color: "#888",
    textTransform: "uppercase",
  },
  tableHeaderMeta: { fontSize: 11, fontWeight: "700", color: "#888", textTransform: "uppercase" },
  tableHeaderValue: {
    minWidth: 72,
    fontSize: 11,
    fontWeight: "700",
    color: "#888",
    textTransform: "uppercase",
    textAlign: "right",
  },
  tableRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
    gap: 12,
  },
  tableRowOdd: { backgroundColor: "#fafafa" },
  tableMain: { flex: 1, gap: 2 },
  rowName: { fontSize: 15, fontWeight: "600" },
  rowMeta: { fontSize: 12, color: "#666" },
  // Currency/number values stay right-aligned regardless of UI direction --
  // numbers are read left-to-right internally no matter the surrounding
  // language, which is the standard convention this mirrors.
  rowValue: { fontSize: 15, fontWeight: "700", minWidth: 72, textAlign: "right" },
  rowValueNegative: { color: "#b3261e" },
  empty: { color: "#666", fontSize: 14 },
  exportRow: { flexDirection: "row", gap: 10, marginTop: 8 },
  exportButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: "#1d7a46",
    alignItems: "center",
  },
  exportText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  error: { color: "#b3261e" },
});
