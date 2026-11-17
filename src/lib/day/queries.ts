import { supabase } from "@/src/lib/supabase/client";
import type { CashierDay } from "@/src/lib/day/math";

export type DayClose = {
  day: string;
  opening_float_cents: number;
  expected_cash_cents: number;
  counted_cash_cents: number;
  leave_in_drawer_cents: number;
  note: string | null;
  closed_at: string;
};

export type DaySummary = {
  day: string;
  closed: boolean;
  // An owner gets every cashier; a cashier only their own row.
  cashiers: CashierDay[];
  // Owner only; null for a cashier.
  close: DayClose | null;
  suggested_float_cents: number;
  // The store's calendar day right now.
  today: string;
};

// day null: the store's own today, whatever this device's clock says.
export async function fetchDaySummary(day: string | null): Promise<DaySummary> {
  const { data, error } = await supabase.rpc("day_summary", { p_day: day });
  if (error) throw new Error(error.message);
  return data as DaySummary;
}

// Owner only. The expected cash is computed by the database, not sent.
export async function closeDay(input: {
  day: string;
  openingFloatCents: number;
  countedCashCents: number;
  leaveInDrawerCents: number;
  note: string;
}): Promise<void> {
  const { error } = await supabase.rpc("close_day", {
    p_day: input.day,
    p_opening_float_cents: input.openingFloatCents,
    p_counted_cash_cents: input.countedCashCents,
    p_leave_in_drawer_cents: input.leaveInDrawerCents,
    p_note: input.note,
  });
  if (error) throw new Error(error.message);
}

export async function reopenDay(day: string): Promise<void> {
  const { error } = await supabase.rpc("reopen_day", { p_day: day });
  if (error) throw new Error(error.message);
}

// Whether the store's today is closed; false when it cannot be asked (offline).
export async function fetchTodayClosed(): Promise<boolean> {
  const { data, error } = await supabase.rpc("day_is_closed");
  if (error) return false;
  return data === true;
}
