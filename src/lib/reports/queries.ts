import { supabase } from "@/src/lib/supabase/client";

export type ReportSummary = {
  revenue_cents: number;
  cogs_cents: number;
  gross_profit_cents: number;
  margin_percent: number | null;
  transaction_count: number;
  average_basket_cents: number;
  loss_cents: number;
};

export type DailyPoint = {
  day: string;
  revenue_cents: number;
  profit_cents: number;
  transaction_count: number;
};

export type CategoryRow = {
  category_id: string | null;
  category_name: string;
  quantity: number;
  revenue_cents: number;
  profit_cents: number;
};

export type HourRow = { hour: number; revenue_cents: number; transaction_count: number };

export type ProductPerformance = {
  product_id: string;
  product_name: string;
  unit: string;
  quantity: number;
  revenue_cents: number;
  profit_cents: number;
  margin_percent: number | null;
};

export type DeadStockRow = {
  product_id: string;
  product_name: string;
  unit: string;
  stock_quantity: number;
  stock_value_cents: number;
  last_sold_at: string | null;
};

export type InventoryValue = {
  product_count: number;
  unit_count: number;
  cost_value_cents: number;
  retail_value_cents: number;
  potential_profit_cents: number;
  // Always <= 0: the cost of stock oversold below zero, excluded from
  // cost_value_cents (floored at zero per product) rather than letting it
  // silently offset the value of real stock elsewhere.
  oversold_value_cents: number;
};

async function callReport<T>(fn: string, params: Record<string, unknown>): Promise<T[]> {
  const { data, error } = await supabase.rpc(fn, params);
  if (error) throw new Error(error.message);
  return (data ?? []) as T[];
}

// The store's own configured time zone (owner setting, default
// Africa/Casablanca) -- never the browser's. report_by_hour and
// report_daily_trend read this server-side via store_timezone(); the
// client only needs it to compute day-range boundaries (today/yesterday/
// this month/etc.) in src/lib/reports/ranges.ts so the two layers agree
// on what day a sale falls on.
const DEFAULT_STORE_TIMEZONE = "Africa/Casablanca";

export async function fetchStoreTimezone(): Promise<string> {
  const { data, error } = await supabase.rpc("store_timezone");
  if (error) throw new Error(error.message);
  return (data as string | null) ?? DEFAULT_STORE_TIMEZONE;
}

export async function updateStoreTimezone(timezone: string): Promise<void> {
  const { error } = await supabase
    .from("store_settings")
    .update({ timezone })
    .eq("singleton", true);
  if (error) throw new Error(error.message);
}

export async function fetchSummary(from: Date, to: Date): Promise<ReportSummary> {
  const rows = await callReport<ReportSummary>("report_summary", {
    p_from: from.toISOString(),
    p_to: to.toISOString(),
  });
  return (
    rows[0] ?? {
      revenue_cents: 0,
      cogs_cents: 0,
      gross_profit_cents: 0,
      margin_percent: null,
      transaction_count: 0,
      average_basket_cents: 0,
      loss_cents: 0,
    }
  );
}

export function fetchDailyTrend(from: Date, to: Date): Promise<DailyPoint[]> {
  return callReport<DailyPoint>("report_daily_trend", {
    p_from: from.toISOString(),
    p_to: to.toISOString(),
  });
}

export function fetchByCategory(from: Date, to: Date): Promise<CategoryRow[]> {
  return callReport<CategoryRow>("report_by_category", {
    p_from: from.toISOString(),
    p_to: to.toISOString(),
  });
}

export function fetchByHour(from: Date, to: Date): Promise<HourRow[]> {
  return callReport<HourRow>("report_by_hour", {
    p_from: from.toISOString(),
    p_to: to.toISOString(),
  });
}

export function fetchProductPerformance(from: Date, to: Date): Promise<ProductPerformance[]> {
  return callReport<ProductPerformance>("report_product_performance", {
    p_from: from.toISOString(),
    p_to: to.toISOString(),
  });
}

export function fetchDeadStock(days = 30): Promise<DeadStockRow[]> {
  return callReport<DeadStockRow>("report_dead_stock", { p_days: days });
}

export async function fetchInventoryValue(): Promise<InventoryValue> {
  const rows = await callReport<InventoryValue>("report_inventory_value", {});
  return (
    rows[0] ?? {
      product_count: 0,
      unit_count: 0,
      cost_value_cents: 0,
      retail_value_cents: 0,
      potential_profit_cents: 0,
      oversold_value_cents: 0,
    }
  );
}
