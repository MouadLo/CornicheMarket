// Every loyalty call. Screens never import supabase: they come here.
import { supabase } from "@/src/lib/supabase/client";
import {
  DEFAULT_LOYALTY_SETTINGS,
  parseLoyaltySettings,
  ratesFromSettings,
  type LoyaltySettings,
} from "@/src/lib/loyalty/settings";

import { mapLoyaltyReport, type LoyaltyReport } from "@/src/lib/loyalty/report";

export { DEFAULT_LOYALTY_SETTINGS, ratesFromSettings };
export type { LoyaltyReport };
export type { LoyaltySettings };

// --- settings (store_settings) ----------------------------------------------
// Readable by every signed-in user (the counter needs the rates), updated by
// the owner only (row-level security).
const SETTINGS_COLUMNS =
  "loyalty_enabled, loyalty_cents_per_point, loyalty_point_value_cents, loyalty_min_redeem_points, loyalty_daily_review_points, loyalty_welcome_points";

export async function fetchLoyaltySettings(): Promise<LoyaltySettings> {
  const { data, error } = await supabase
    .from("store_settings")
    .select(SETTINGS_COLUMNS)
    .eq("singleton", true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return parseLoyaltySettings(data as Record<string, unknown> | null);
}

export async function updateLoyaltySettings(settings: LoyaltySettings): Promise<void> {
  const { error } = await supabase
    .from("store_settings")
    .update({
      loyalty_enabled: settings.enabled,
      loyalty_cents_per_point: settings.centsPerPoint,
      loyalty_point_value_cents: settings.pointValueCents,
      loyalty_min_redeem_points: settings.minRedeemPoints,
      loyalty_daily_review_points: settings.dailyReviewPoints,
      loyalty_welcome_points: settings.welcomePoints,
    })
    .eq("singleton", true);
  if (error) throw new Error(error.message);
}

// --- exclusions and bonus ----------------------------------------------------
export type LoyaltyCategory = {
  id: string;
  name: string;
  code: string | null;
  parent_id: string | null;
  loyalty_excluded: boolean;
};

export async function fetchLoyaltyCategories(): Promise<LoyaltyCategory[]> {
  const { data, error } = await supabase
    .from("categories")
    .select("id, name, code, parent_id, loyalty_excluded")
    .order("name");
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    id: String(row.id),
    name: String(row.name),
    code: (row.code as string | null) ?? null,
    parent_id: (row.parent_id as string | null) ?? null,
    loyalty_excluded: row.loyalty_excluded === true,
  }));
}

// Owner only (column grant). A main category's exclusion covers its sub-categories.
export async function setCategoryLoyaltyExcluded(id: string, excluded: boolean): Promise<void> {
  const { error } = await supabase
    .from("categories")
    .update({ loyalty_excluded: excluded })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export type ProductLoyalty = {
  loyalty_excluded: boolean;
  loyalty_bonus_points: number;
  // The instant the promo ends (null = no end).
  loyalty_bonus_until: string | null;
};

export async function updateProductLoyalty(id: string, loyalty: ProductLoyalty): Promise<void> {
  const { error } = await supabase.from("products").update(loyalty).eq("id", id);
  if (error) throw new Error(error.message);
}

// --- members ------------------------------------------------------------------
export type LoyaltyJoinResult = {
  customerId: string;
  name: string;
  balance: number;
  // The only moment a cashier gets the token: to share the card link.
  cardToken: string;
  created: boolean;
};

export type LoyaltyLookupResult = {
  customerId: string;
  name: string;
  balance: number;
  isMember: boolean;
};

export type LoyaltyCardCustomer = { customerId: string; name: string; balance: number };

export type RedeemRefusal =
  "disabled" | "not_member" | "no_proof" | "below_minimum" | "over_balance";

export type RedeemCheck = {
  ok: boolean;
  reason: RedeemRefusal | null;
  balance: number;
  valueCents: number;
};

export type PublicCard = {
  firstName: string | null;
  balancePoints: number;
  balanceValueCents: number;
  pointValueCents: number;
  centsPerPoint: number;
  history: { createdAt: string; kind: string; points: number }[];
};

export type MemberDetails = {
  customerId: string;
  name: string;
  phoneE164: string | null;
  cardToken: string | null;
  joinedAt: string | null;
  balance: number;
};

export type LoyaltyLedgerRow = {
  id: string;
  saleId: string | null;
  kind: string;
  points: number;
  bonusPoints: number;
  note: string | null;
  createdAt: string;
};

type Row = Record<string, unknown>;
const firstRow = (data: unknown): Row | null =>
  Array.isArray(data) ? ((data[0] as Row) ?? null) : null;
const num = (value: unknown): number => Number(value ?? 0);

export function mapJoinRow(row: Row): LoyaltyJoinResult {
  return {
    customerId: String(row.customer_id),
    name: String(row.name ?? ""),
    balance: num(row.balance),
    cardToken: String(row.card_token),
    created: row.created === true,
  };
}

export function mapLookupRow(row: Row): LoyaltyLookupResult {
  return {
    customerId: String(row.customer_id),
    name: String(row.name ?? ""),
    balance: num(row.balance),
    isMember: row.is_member === true,
  };
}

export function mapRedeemCheck(data: unknown): RedeemCheck {
  const row = (data ?? {}) as Row;
  return {
    ok: row.ok === true,
    reason: (row.reason as RedeemRefusal | null) ?? null,
    balance: num(row.balance),
    valueCents: num(row.value_cents),
  };
}

export function mapPublicCard(data: unknown): PublicCard | null {
  if (!data || typeof data !== "object") return null;
  const row = data as Row;
  const history = Array.isArray(row.history) ? (row.history as Row[]) : [];
  return {
    firstName: typeof row.first_name === "string" && row.first_name !== "" ? row.first_name : null,
    balancePoints: num(row.balance_points),
    balanceValueCents: num(row.balance_value_cents),
    pointValueCents: num(row.point_value_cents) || DEFAULT_LOYALTY_SETTINGS.pointValueCents,
    centsPerPoint: num(row.cents_per_point) || DEFAULT_LOYALTY_SETTINGS.centsPerPoint,
    history: history.map((h) => ({
      createdAt: String(h.created_at),
      kind: String(h.kind),
      points: num(h.points),
    })),
  };
}

export function mapMemberDetails(row: Row): MemberDetails {
  return {
    customerId: String(row.customer_id),
    name: String(row.name ?? ""),
    phoneE164: (row.phone_e164 as string | null) ?? null,
    cardToken: (row.card_token as string | null) ?? null,
    joinedAt: (row.joined_at as string | null) ?? null,
    balance: num(row.balance),
  };
}

export function mapLedgerRow(row: Row): LoyaltyLedgerRow {
  return {
    id: String(row.id),
    saleId: (row.sale_id as string | null) ?? null,
    kind: String(row.kind),
    points: num(row.points),
    bonusPoints: num(row.bonus_points),
    note: (row.note as string | null) ?? null,
    createdAt: String(row.created_at),
  };
}

// Join (or find) a member by phone. Consent is mandatory.
export async function loyaltyJoin(
  phone: string,
  name: string | null,
  consent: boolean
): Promise<LoyaltyJoinResult> {
  const { data, error } = await supabase.rpc("loyalty_join", {
    p_phone: phone,
    p_name: name,
    p_consent: consent,
  });
  if (error) throw new Error(error.message);
  const row = firstRow(data);
  if (!row) throw new Error("Not a loyalty member");
  return mapJoinRow(row);
}

export async function loyaltyLookup(phone: string): Promise<LoyaltyLookupResult | null> {
  const { data, error } = await supabase.rpc("loyalty_lookup", { p_phone: phone });
  if (error) throw new Error(error.message);
  const row = firstRow(data);
  return row ? mapLookupRow(row) : null;
}

// A scanned card QR is the proof of presence: null when the token is unknown.
export async function loyaltyCardCustomer(token: string): Promise<LoyaltyCardCustomer | null> {
  const { data, error } = await supabase.rpc("loyalty_card_customer", { p_token: token });
  if (error) throw new Error(error.message);
  const row = firstRow(data);
  return row
    ? {
        customerId: String(row.customer_id),
        name: String(row.name ?? ""),
        balance: num(row.balance),
      }
    : null;
}

export async function loyaltyCheckRedeem(
  customerId: string,
  points: number,
  cardToken: string | null
): Promise<RedeemCheck> {
  const { data, error } = await supabase.rpc("loyalty_check_redeem", {
    p_customer_id: customerId,
    p_points: points,
    p_card_token: cardToken,
  });
  if (error) throw new Error(error.message);
  return mapRedeemCheck(data);
}

// The public card page: works signed out. null = unknown or replaced card.
export async function fetchPublicCard(token: string): Promise<PublicCard | null> {
  const { data, error } = await supabase.rpc("loyalty_card", { p_token: token });
  if (error) throw new Error(error.message);
  return mapPublicCard(data);
}

// Owner only. Returns the new balance.
export async function loyaltyAdjust(
  customerId: string,
  points: number,
  note: string
): Promise<number> {
  const { data, error } = await supabase.rpc("loyalty_adjust", {
    p_customer_id: customerId,
    p_points: points,
    p_note: note,
  });
  if (error) throw new Error(error.message);
  return num(data);
}

// Owner only. The old QR stops working; returns the new token.
export async function loyaltyResetCard(customerId: string): Promise<string> {
  const { data, error } = await supabase.rpc("loyalty_reset_card", { p_customer_id: customerId });
  if (error) throw new Error(error.message);
  return String(data);
}

export async function fetchMemberDetails(customerId: string): Promise<MemberDetails | null> {
  const { data, error } = await supabase.rpc("loyalty_member_details", {
    p_customer_id: customerId,
  });
  if (error) throw new Error(error.message);
  const row = firstRow(data);
  return row ? mapMemberDetails(row) : null;
}

// Owner only: balance of every member, for the Clients list.
export async function fetchLoyaltyBalances(): Promise<Map<string, number>> {
  const { data, error } = await supabase.rpc("loyalty_balances");
  if (error) throw new Error(error.message);
  const balances = new Map<string, number>();
  for (const row of (data ?? []) as Row[]) balances.set(String(row.customer_id), num(row.balance));
  return balances;
}

// Who is a member (loyalty_joined_at is readable by everyone, nothing else is).
export async function fetchMemberIds(): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("customers")
    .select("id")
    .not("loyalty_joined_at", "is", null);
  if (error) throw new Error(error.message);
  return new Set(((data ?? []) as { id: string }[]).map((row) => row.id));
}

// Owner only (row-level security): one member's ledger, newest first.
export async function fetchLoyaltyLedger(
  customerId: string,
  limit = 30,
  offset = 0
): Promise<LoyaltyLedgerRow[]> {
  const { data, error } = await supabase
    .from("loyalty_ledger")
    .select("id, sale_id, kind, points, bonus_points, note, created_at")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw new Error(error.message);
  return ((data ?? []) as Row[]).map(mapLedgerRow);
}

// --- report --------------------------------------------------------------------
export async function fetchLoyaltyReport(from: Date, to: Date): Promise<LoyaltyReport> {
  const { data, error } = await supabase.rpc("report_loyalty", {
    p_from: from.toISOString(),
    p_to: to.toISOString(),
  });
  if (error) throw new Error(error.message);
  return mapLoyaltyReport(data);
}

// Is this one customer a member? (Readable by everyone, as the list's badge is.)
export async function fetchIsMember(customerId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("customers")
    .select("loyalty_joined_at")
    .eq("id", customerId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return !!(data as { loyalty_joined_at: string | null } | null)?.loyalty_joined_at;
}

// A customer's free-text phone (customers.phone), so that joining by number
// finds THIS customer instead of creating a second one.
export async function updateCustomerPhone(customerId: string, phone: string): Promise<void> {
  const { error } = await supabase.from("customers").update({ phone }).eq("id", customerId);
  if (error) throw new Error(error.message);
}
