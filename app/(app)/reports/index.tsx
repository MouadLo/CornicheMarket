import { Redirect, router } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { localizeCategoryName } from "@/src/lib/products/categoryCatalog";

import { Chip } from "@/src/components/ui/Chip";
import { DateField } from "@/src/components/ui/DateField";
import { Icon } from "@/src/components/ui/Icon";
import { MiniBarChart, type ChartPoint } from "@/src/components/reports/MiniBarChart";
import { useAuth } from "@/src/lib/auth/AuthProvider";
import { pointsText } from "@/src/lib/loyalty/display";
import { fetchLoyaltyReport } from "@/src/lib/loyalty/queries";
import { memberSalesShare, type LoyaltyReport } from "@/src/lib/loyalty/report";
import { centsToDisplay, formatMAD, formatMargin } from "@/src/lib/money";
import { exportTablesAsCsv, exportTablesAsPdf } from "@/src/lib/reports/export";
import { buildReportTables } from "@/src/lib/reports/exportTables";
import { compareByMetricThenName, diversSharePercent } from "@/src/lib/reports/math";
import {
  fetchByCategory,
  fetchByHour,
  fetchDailyTrend,
  fetchDeadStock,
  fetchDiversReport,
  fetchInventoryValue,
  fetchProductPerformance,
  fetchStoreTimezone,
  fetchSummary,
  type CategoryRow,
  type DailyPoint,
  type DeadStockRow,
  type DiversReport,
  type HourRow,
  type InventoryValue,
  type ProductPerformance,
  type ReportSummary,
} from "@/src/lib/reports/queries";
import {
  DEFAULT_STORE_TIMEZONE,
  isSingleStoreDay,
  isValidDateInput,
  resolveRange,
  type RangeKey,
} from "@/src/lib/reports/ranges";
import { historyRangeParams } from "@/src/lib/sales/historyRange";
import { Text } from "@/src/theme/Text";
import { colors } from "@/src/theme/tokens";
import { appDirection, isolateBidi, isolateLtr } from "@/src/lib/text/bidi";
import { storeDayKey } from "@/src/lib/sales/historyView";
import { formatLocaleDate, formatLocaleDateTime } from "@/src/lib/text/dates";
import { unitLabel } from "@/src/lib/products/unitLabel";

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
  const { t, i18n } = useTranslation();
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
  // null = not read (or it failed): the card is left out, the rest still shows.
  const [loyalty, setLoyalty] = useState<LoyaltyReport | null>(null);
  // null = not read (or it failed): the card is left out, the rest still shows.
  const [divers, setDivers] = useState<DiversReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // The owner-configured store time zone, fetched once and reused for
  // every boundary computed on this screen (today/yesterday/month, and
  // the day/hour buckets the server groups by). Defaults to Casablanca
  // while the setting is still loading.
  const [timeZone, setTimeZone] = useState(DEFAULT_STORE_TIMEZONE);
  const [showAllDeadStock, setShowAllDeadStock] = useState(false);

  useEffect(() => {
    fetchStoreTimezone()
      .then(setTimeZone)
      .catch(() => {});
  }, []);

  // The store's calendar day, not the device's: the latest date a report may reach.
  const todayKey = storeDayKey(new Date().toISOString(), timeZone);

  const range = useMemo(
    () =>
      resolveRange(
        rangeKey,
        isValidDateInput(customFrom) ? customFrom : undefined,
        isValidDateInput(customTo) ? customTo : undefined,
        timeZone
      ),
    [rangeKey, customFrom, customTo, timeZone]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const todayRange = resolveRange("today", undefined, undefined, timeZone);
      const [
        todaySummary,
        rangeSummary,
        trend,
        byCategory,
        byHour,
        performance,
        dead,
        inventoryValue,
        loyaltyReport,
        diversReport,
      ] = await Promise.all([
        fetchSummary(todayRange.from, todayRange.to),
        fetchSummary(range.from, range.to),
        fetchDailyTrend(range.from, range.to),
        fetchByCategory(range.from, range.to),
        fetchByHour(range.from, range.to),
        fetchProductPerformance(range.from, range.to),
        fetchDeadStock(30),
        fetchInventoryValue(),
        // Extra: a failure here must never hide the other reports.
        Promise.resolve()
          .then(() => fetchLoyaltyReport(range.from, range.to))
          .catch(() => null),
        Promise.resolve()
          .then(() => fetchDiversReport(range.from, range.to))
          .catch(() => null),
      ]);

      setToday(todaySummary);
      setSummary(rangeSummary);
      setDaily(trend);
      setCategories(byCategory);
      setHours(byHour);
      setProducts(performance);
      setDeadStock(dead);
      setInventory(inventoryValue);
      setLoyalty(loyaltyReport);
      setDivers(diversReport);
      setShowAllDeadStock(false);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t("reports.loadError"));
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to, t, timeZone]);

  useEffect(() => {
    if (isOwner) load();
  }, [isOwner, load]);

  if (profile && !isOwner) return <Redirect href="/(app)/sell" />;

  const topByProfit = [...products]
    .sort((a, b) =>
      compareByMetricThenName(
        { value: a.profit_cents, name: a.product_name },
        { value: b.profit_cents, name: b.product_name },
        "desc"
      )
    )
    .slice(0, 20);
  const topByQuantity = [...products]
    .sort((a, b) =>
      compareByMetricThenName(
        { value: a.quantity, name: a.product_name },
        { value: b.quantity, name: b.product_name },
        "desc"
      )
    )
    .slice(0, 20);
  const lowestMargin = [...products]
    .filter((product) => product.margin_percent !== null)
    .sort((a, b) =>
      compareByMetricThenName(
        { value: a.margin_percent as number, name: a.product_name },
        { value: b.margin_percent as number, name: b.product_name },
        "asc"
      )
    )
    .slice(0, 20);

  // Revenue and Transactions open the sales behind them, for the same range.
  const openSales = (target: { from: Date; to: Date }) =>
    router.push({ pathname: "/(app)/sell/history", params: historyRangeParams(target) });
  const singleDay = isSingleStoreDay(range, timeZone);

  const hourPoints = hours.map<ChartPoint>((row) => ({
    key: String(row.hour),
    label: `${String(row.hour).padStart(2, "0")}h`,
    value: row.revenue_cents,
  }));

  const buildTables = () =>
    buildReportTables(
      {
        rangeLabel: t(range.labelKey),
        summary,
        inventory,
        daily,
        categories,
        topByProfit,
        topByQuantity,
        lowestMargin,
        deadStock,
        timeZone,
        language: i18n.language,
      },
      t
    );

  const fileStamp = new Date().toISOString().slice(0, 10);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>{t("reports.title")}</Text>

      {today && rangeKey !== "today" && (
        <View style={styles.todayCard}>
          <Text style={styles.todayLabel}>{t("reports.today")}</Text>
          <View style={styles.todayGrid}>
            <Metric
              label={t("reports.metricRevenue")}
              value={formatMAD(today.revenue_cents)}
              large
              onPress={() => openSales(resolveRange("today", undefined, undefined, timeZone))}
              hint={t("reports.openSalesHint")}
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
              onPress={() => openSales(resolveRange("today", undefined, undefined, timeZone))}
              hint={t("reports.openSalesHint")}
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
          <Chip
            key={option.key}
            label={t(option.tKey)}
            selected={rangeKey === option.key}
            onPress={() => setRangeKey(option.key)}
          />
        ))}
      </View>

      {rangeKey === "custom" && (
        <View style={styles.customRow}>
          <DateField
            label={t("reports.fromDate")}
            value={customFrom}
            onChange={setCustomFrom}
            today={todayKey}
            max={customTo || todayKey}
          />
          <DateField
            label={t("reports.toDate")}
            value={customTo}
            onChange={setCustomTo}
            today={todayKey}
            min={customFrom || undefined}
            max={todayKey}
          />
        </View>
      )}

      {error && <Text style={styles.error}>{error}</Text>}
      {loading && <ActivityIndicator style={{ marginVertical: 20 }} />}

      {!loading && summary && (
        <>
          <Section title={t("reports.money", { label: t(range.labelKey) })}>
            <View style={styles.metricGrid}>
              <Metric
                label={t("reports.metricRevenue")}
                value={formatMAD(summary.revenue_cents)}
                large
                onPress={() => openSales(range)}
                hint={t("reports.openSalesHint")}
              />
              {(summary.returns_cents ?? 0) > 0 ? (
                <Metric
                  label={t("reports.metricReturns")}
                  value={isolateLtr(`−${formatMAD(summary.returns_cents ?? 0)}`)}
                  negative
                />
              ) : null}
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
                onPress={() => openSales(range)}
                hint={t("reports.openSalesHint")}
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

          {divers && (divers.lineCount > 0 || divers.revenueCents !== 0) ? (
            <Section title={t("reports.diversTitle")}>
              <View style={styles.metricGrid}>
                <Metric label={t("reports.diversLines")} value={String(divers.lineCount)} />
                <Metric
                  label={t("reports.diversRevenue")}
                  value={formatMAD(divers.revenueCents)}
                  large
                />
                <Metric
                  label={t("reports.diversProfit")}
                  value={formatMAD(divers.profitCents)}
                  large
                  accent
                />
              </View>
              {(() => {
                const share = diversSharePercent(divers.revenueCents, summary.revenue_cents);
                return share === null ? null : (
                  <Text style={styles.empty}>
                    {t("reports.diversShare", { percent: isolateLtr(`${share} %`) })}
                  </Text>
                );
              })()}
              <Text style={styles.empty}>{t("reports.diversHint")}</Text>
            </Section>
          ) : null}

          {singleDay ? (
            <Section title={t("reports.byHour")}>
              <MiniBarChart columnWidth={56} points={hourPoints} />
            </Section>
          ) : (
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
          )}

          <Section title={t("reports.byCategory")}>
            <MiniBarChart
              points={categories.map<ChartPoint>((row) => ({
                key: row.category_id ?? row.category_name,
                label: isolateBidi(localizeCategoryName(row.category_name, i18n.language)),
                value: row.revenue_cents,
                secondary: row.profit_cents,
              }))}
              secondaryLabel={t("reports.profit")}
            />
          </Section>

          {!singleDay && (
            <Section title={t("reports.byHour")}>
              <MiniBarChart columnWidth={56} points={hourPoints} />
            </Section>
          )}

          {loyalty && (
            <Section title={t("loyalty.reportTitle")}>
              <View style={styles.metricGrid}>
                <Metric
                  label={t("loyalty.reportValueSpent")}
                  value={formatMAD(loyalty.valueRedeemedCents)}
                  large
                />
                <Metric
                  label={t("loyalty.reportPointsSpent")}
                  value={pointsText(t, loyalty.pointsRedeemed)}
                />
                <Metric
                  label={t("loyalty.reportPointsEarned")}
                  value={pointsText(t, loyalty.pointsEarned)}
                  large
                />
                <Metric
                  label={t("loyalty.reportPointsBonus")}
                  value={pointsText(t, loyalty.pointsBonus)}
                />
                <Metric
                  label={t("loyalty.reportMembers")}
                  value={isolateLtr(`${loyalty.membersNew} / ${loyalty.membersTotal}`)}
                />
                <Metric
                  label={t("loyalty.reportMemberShare")}
                  value={(() => {
                    const share = memberSalesShare(loyalty);
                    return share === null ? "—" : isolateLtr(`${share}%`);
                  })()}
                />
              </View>

              <Text style={styles.tableTitle}>{t("loyalty.reportTopMembers")}</Text>
              {loyalty.topMembers.length === 0 ? (
                <Text style={styles.empty}>{t("loyalty.reportNoMembers")}</Text>
              ) : (
                <>
                  <ReportTableHeader
                    mainLabel={t("loyalty.reportColMember")}
                    metaLabel={t("loyalty.reportColBalance")}
                    valueLabel={t("loyalty.reportColSales")}
                  />
                  {loyalty.topMembers.map((member, index) => (
                    <ReportRow
                      key={`${member.name}-${index}`}
                      index={index}
                      name={member.name}
                      subtitle={pointsText(t, member.pointsBalance)}
                      value={formatMAD(member.salesCents)}
                    />
                  ))}
                </>
              )}

              {loyalty.topBonusProducts.length > 0 ? (
                <>
                  <Text style={styles.tableTitle}>{t("loyalty.reportTopBonus")}</Text>
                  {loyalty.topBonusProducts.map((product, index) => (
                    <ReportRow
                      key={`${product.productName}-${index}`}
                      index={index}
                      name={product.productName}
                      value={pointsText(t, product.bonusPoints)}
                    />
                  ))}
                </>
              ) : null}
            </Section>
          )}

          {inventory && (
            <Section title={t("reports.inventoryValue")}>
              <Text style={styles.snapshotLabel}>{t("reports.snapshotNotice")}</Text>
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
              {inventory.oversold_value_cents < 0 && (
                <Text style={styles.oversoldWarning}>
                  {t("reports.oversoldWarning", {
                    amount: isolateLtr(formatMAD(-inventory.oversold_value_cents)),
                  })}
                </Text>
              )}
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
              <>
                <Text style={styles.deadStockTotal}>
                  {t("reports.deadStockTotal", {
                    amount: isolateLtr(
                      formatMAD(deadStock.reduce((sum, row) => sum + row.stock_value_cents, 0))
                    ),
                  })}
                </Text>
                <ReportTableHeader
                  mainLabel={t("reports.colProduct")}
                  metaLabel={t("reports.colStock")}
                  valueLabel={t("reports.colValueAtCost")}
                />
                {(showAllDeadStock ? deadStock : deadStock.slice(0, 20)).map((row, index) => (
                  <ReportRow
                    key={row.product_id}
                    index={index}
                    name={row.product_name}
                    subtitle={`${row.stock_quantity} ${unitLabel(row.unit, row.stock_quantity, t)} · ${
                      row.last_sold_at
                        ? t("reports.deadStockLastSold", {
                            date: formatLocaleDate(new Date(row.last_sold_at), i18n.language),
                          })
                        : t("reports.deadStockNeverSold")
                    }`}
                    value={formatMAD(row.stock_value_cents)}
                  />
                ))}
                {deadStock.length > 20 && (
                  <Pressable
                    accessibilityRole="button"
                    style={styles.showAllButton}
                    onPress={() => setShowAllDeadStock((prev) => !prev)}
                  >
                    <Text style={styles.showAllText}>
                      {showAllDeadStock
                        ? t("reports.showLess")
                        : t("reports.showAll", { count: deadStock.length })}
                    </Text>
                  </Pressable>
                )}
              </>
            )}
          </Section>

          <View style={styles.exportRow}>
            <Pressable
              accessibilityRole="button"
              style={styles.exportButton}
              onPress={() => exportTablesAsCsv(`report-${fileStamp}.csv`, buildTables())}
            >
              <Text style={styles.exportText}>{t("reports.exportCsv")}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              style={styles.exportButton}
              onPress={() =>
                exportTablesAsPdf(
                  t("reports.csv.heading"),
                  t("reports.csv.generated", {
                    range: t(range.labelKey),
                    date: formatLocaleDateTime(new Date(), i18n.language),
                  }),
                  buildTables(),
                  i18n.language
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
  onPress,
  hint,
}: {
  label: string;
  value: string;
  large?: boolean;
  accent?: boolean;
  negative?: boolean;
  onPress?: () => void;
  hint?: string;
}) {
  const body = (
    <>
      <Text style={styles.metricLabel}>{label}</Text>
      <View style={styles.metricValueRow}>
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
        {onPress ? <Icon name="chevron" size={20} color={colors.brand700} /> : null}
      </View>
    </>
  );
  if (!onPress) return <View style={styles.metric}>{body}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      accessibilityHint={hint}
      onPress={onPress}
      style={({ pressed }) => [styles.metric, styles.metricTap, pressed && styles.pressed]}
    >
      {body}
    </Pressable>
  );
}

// Shared by every row in Reports that pairs a product/line name with a
// subtitle and a trailing value (the three ProductTable rankings and the
// dead-stock list). Centralising it here is what makes the RTL isolation
// fix (isolateBidi + appDirection) apply everywhere at once instead of
// needing to be remembered per call site -- see
// docs/PRE-LAUNCH-GAPS.md-style audits: a name-rendering spot that forgets
// this wrapping is exactly how the original row-flip bug happened.
function ReportTableHeader({
  mainLabel,
  metaLabel,
  valueLabel,
}: {
  mainLabel: string;
  metaLabel: string;
  valueLabel: string;
}) {
  const { i18n } = useTranslation();
  const dir = appDirection(i18n.language);
  const textAlign = dir === "rtl" ? "right" : "left";

  return (
    <View style={[styles.tableHeader, { direction: dir }]}>
      <Text style={[styles.tableHeaderMain, { textAlign }]}>{mainLabel}</Text>
      <Text style={[styles.tableHeaderMeta, { textAlign }]}>{metaLabel}</Text>
      <Text style={styles.tableHeaderValue}>{valueLabel}</Text>
    </View>
  );
}

function ReportRow({
  name,
  subtitle,
  value,
  valueNegative,
  index,
}: {
  name: string;
  subtitle?: string;
  value: string;
  valueNegative?: boolean;
  index: number;
}) {
  const { i18n } = useTranslation();
  // The row's layout direction follows the APP language, never the
  // content of any one row -- an Arabic product name must not flip a
  // French-locale row (or vice versa). RN's `direction` style property is
  // a real Yoga layout property, honoured on iOS/Android/web alike, unlike
  // relying on global RTL state (which this intentionally overrides per
  // row so every row is internally consistent with the table as a whole).
  const dir = appDirection(i18n.language);
  const textAlign = dir === "rtl" ? "right" : "left";

  return (
    <View style={[styles.tableRow, { direction: dir }, index % 2 === 1 && styles.tableRowOdd]}>
      <View style={styles.tableMain}>
        <Text style={[styles.rowName, { textAlign }]} numberOfLines={1}>
          {isolateBidi(name)}
        </Text>
        {subtitle ? <Text style={[styles.rowMeta, { textAlign }]}>{subtitle}</Text> : null}
      </View>
      <Text style={[styles.rowValue, valueNegative && styles.rowValueNegative]}>{value}</Text>
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
  const { t } = useTranslation();
  if (rows.length === 0) {
    return <Text style={styles.empty}>{t("reports.noSales")}</Text>;
  }

  return (
    <>
      <ReportTableHeader
        mainLabel={t("reports.colProduct")}
        metaLabel={t("reports.colQtyRevenue")}
        valueLabel={valueLabel}
      />
      {rows.map((row, index) => (
        <ReportRow
          key={row.product_id}
          index={index}
          name={row.product_name}
          subtitle={`${row.quantity} ${unitLabel(row.unit, row.quantity, t)} · ${isolateLtr(formatMAD(row.revenue_cents))}`}
          value={renderValue(row)}
          valueNegative={warnBelowZero && (row.margin_percent ?? 0) < 0}
        />
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
  todayCard: { backgroundColor: colors.brand50, borderRadius: 14, padding: 16, gap: 10 },
  todayLabel: { fontSize: 13, fontWeight: "700", color: colors.ink600, textTransform: "uppercase" },
  todayGrid: { flexDirection: "row", flexWrap: "wrap", gap: 14 },
  oversoldWarning: { color: colors.danger600, fontSize: 13, marginTop: 4 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  customRow: { flexDirection: "row", gap: 10 },
  section: { gap: 10 },
  sectionTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.ink700,
    textTransform: "uppercase",
  },
  metricGrid: { flexDirection: "row", flexWrap: "wrap", gap: 14 },
  metric: { minWidth: 120, flexGrow: 1, gap: 3 },
  metricValueRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  metricTap: { minHeight: 48, justifyContent: "center" },
  pressed: { opacity: 0.85 },
  metricLabel: { fontSize: 13, color: colors.ink600, textTransform: "uppercase" },
  metricValue: { fontSize: 18, fontWeight: "700" },
  metricValueLarge: { fontSize: 24, fontWeight: "800" },
  metricAccent: { color: colors.success700 },
  metricNegative: { color: colors.danger600 },
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
    fontSize: 13,
    fontWeight: "700",
    color: colors.ink600,
    textTransform: "uppercase",
  },
  tableHeaderMeta: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.ink600,
    textTransform: "uppercase",
  },
  tableHeaderValue: {
    minWidth: 72,
    fontSize: 13,
    fontWeight: "700",
    color: colors.ink600,
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
    borderBottomColor: colors.divider,
    gap: 12,
  },
  tableRowOdd: { backgroundColor: colors.bg },
  tableMain: { flex: 1, gap: 2 },
  rowName: { fontSize: 15, fontWeight: "600" },
  rowMeta: { fontSize: 13, color: colors.ink600 },
  // Currency/number values stay right-aligned regardless of UI direction --
  // numbers are read left-to-right internally no matter the surrounding
  // language, which is the standard convention this mirrors.
  rowValue: { fontSize: 15, fontWeight: "700", minWidth: 72, textAlign: "right" },
  rowValueNegative: { color: colors.danger600 },
  empty: { color: colors.ink600, fontSize: 14 },
  tableTitle: { fontSize: 14, fontWeight: "700", color: colors.ink700, marginTop: 8 },
  deadStockTotal: { color: colors.ink700, fontSize: 13, fontWeight: "600", marginBottom: 6 },
  snapshotLabel: { color: colors.ink600, fontSize: 13, fontStyle: "italic", marginBottom: 8 },
  showAllButton: { paddingVertical: 10, alignItems: "center" },
  showAllText: { color: colors.brand700, fontWeight: "700", fontSize: 14 },
  exportRow: { flexDirection: "row", gap: 10, marginTop: 8 },
  exportButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: colors.brand700,
    alignItems: "center",
  },
  exportText: { color: colors.white, fontWeight: "700", fontSize: 15 },
  error: { color: colors.danger600 },
});
