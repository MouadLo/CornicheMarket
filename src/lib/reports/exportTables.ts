import { centsToDisplay } from "@/src/lib/money";
import { localizeCategoryName } from "@/src/lib/products/categoryCatalog";
import { unitLabel } from "@/src/lib/products/unitLabel";
import type { ReportTable } from "@/src/lib/reports/export";
import type {
  CategoryRow,
  DailyPoint,
  DeadStockRow,
  InventoryValue,
  ProductPerformance,
  ReportSummary,
} from "@/src/lib/reports/queries";

type Translate = (key: string, options?: Record<string, unknown>) => string;

export type ReportExportData = {
  rangeLabel: string;
  summary: ReportSummary | null;
  inventory: InventoryValue | null;
  daily: DailyPoint[];
  categories: CategoryRow[];
  topByProfit: ProductPerformance[];
  topByQuantity: ProductPerformance[];
  lowestMargin: ProductPerformance[];
  deadStock: DeadStockRow[];
  timeZone: string;
  language: string;
};

// A calendar day as YYYY-MM-DD with Western digits, in the store's time zone,
// whatever the app language (a CSV date must be unambiguous to a spreadsheet).
export function isoDayInTimeZone(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

// Titles, column names and generated text follow the app language; numbers
// never do: amounts stay "12.50" (centimes through centsToDisplay), with the
// currency in the column name.
export function buildReportTables(data: ReportExportData, t: Translate): ReportTable[] {
  const { summary, inventory, language } = data;
  const c = (key: string, options?: Record<string, unknown>) => t(`reports.csv.${key}`, options);
  const margin = (value: number | null) => (value != null ? `${value}` : "—");

  return [
    {
      title: c("summaryTitle", { range: data.rangeLabel }),
      columns: [c("colMetric"), c("colValue")],
      rows: [
        [c("rowRevenue"), centsToDisplay(summary?.revenue_cents ?? 0)],
        [c("rowCogs"), centsToDisplay(summary?.cogs_cents ?? 0)],
        [c("rowGrossProfit"), centsToDisplay(summary?.gross_profit_cents ?? 0)],
        [c("rowMarginPct"), margin(summary?.margin_percent ?? null)],
        [c("rowTransactions"), summary?.transaction_count ?? 0],
        [c("rowAvgBasket"), centsToDisplay(summary?.average_basket_cents ?? 0)],
        [c("rowLosses"), centsToDisplay(summary?.loss_cents ?? 0)],
        [c("rowInventoryCost"), centsToDisplay(inventory?.cost_value_cents ?? 0)],
        [c("rowInventoryRetail"), centsToDisplay(inventory?.retail_value_cents ?? 0)],
      ],
    },
    {
      title: c("dailyTrendTitle"),
      columns: [c("colDay"), c("colRevenue"), c("colProfit"), c("colTransactions")],
      rows: data.daily.map((point) => [
        point.day,
        centsToDisplay(point.revenue_cents),
        centsToDisplay(point.profit_cents),
        point.transaction_count,
      ]),
    },
    {
      title: t("reports.byCategory"),
      columns: [c("colCategory"), c("colQuantity"), c("colRevenue"), c("colProfit")],
      rows: data.categories.map((row) => [
        row.category_id === null && row.category_name === "Uncategorised"
          ? c("uncategorized")
          : localizeCategoryName(row.category_name, language),
        row.quantity,
        centsToDisplay(row.revenue_cents),
        centsToDisplay(row.profit_cents),
      ]),
    },
    {
      title: t("reports.top20ByProfit", { count: 20 }),
      columns: [
        c("colProduct"),
        c("colQuantity"),
        c("colRevenue"),
        c("colProfit"),
        c("colMarginPct"),
      ],
      rows: data.topByProfit.map((row) => [
        row.product_name,
        row.quantity,
        centsToDisplay(row.revenue_cents),
        centsToDisplay(row.profit_cents),
        margin(row.margin_percent),
      ]),
    },
    {
      title: t("reports.top20ByQuantity", { count: 20 }),
      columns: [c("colProduct"), c("colQuantity"), c("colRevenue"), c("colProfit")],
      rows: data.topByQuantity.map((row) => [
        row.product_name,
        row.quantity,
        centsToDisplay(row.revenue_cents),
        centsToDisplay(row.profit_cents),
      ]),
    },
    {
      title: t("reports.lowestMargin"),
      columns: [c("colProduct"), c("colRevenue"), c("colProfit"), c("colMarginPct")],
      rows: data.lowestMargin.map((row) => [
        row.product_name,
        centsToDisplay(row.revenue_cents),
        centsToDisplay(row.profit_cents),
        margin(row.margin_percent),
      ]),
    },
    {
      title: t("reports.deadStock"),
      columns: [
        c("colProduct"),
        c("colStock"),
        c("colUnit"),
        c("colValueAtCost"),
        c("colLastSold"),
      ],
      rows: data.deadStock.map((row) => [
        row.product_name,
        row.stock_quantity,
        unitLabel(row.unit, row.stock_quantity, t),
        centsToDisplay(row.stock_value_cents),
        row.last_sold_at
          ? isoDayInTimeZone(row.last_sold_at, data.timeZone)
          : t("reports.deadStockNeverSold"),
      ]),
    },
  ];
}
