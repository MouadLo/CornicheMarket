// The loyalty report: what the owner reads. Pure mapping of report_loyalty.
type Row = Record<string, unknown>;
const num = (value: unknown): number => Number(value ?? 0);

export type LoyaltyReport = {
  pointsEarned: number;
  pointsBonus: number;
  pointsAdjusted: number;
  pointsRedeemed: number;
  valueRedeemedCents: number;
  membersTotal: number;
  membersNew: number;
  memberSalesCount: number;
  memberSalesCents: number;
  allSalesCents: number;
  topMembers: { name: string; salesCents: number; pointsBalance: number }[];
  topBonusProducts: { productName: string; bonusPoints: number }[];
};

export function mapLoyaltyReport(data: unknown): LoyaltyReport {
  const row = (data ?? {}) as Row;
  const list = (value: unknown) => (Array.isArray(value) ? (value as Row[]) : []);
  return {
    pointsEarned: num(row.points_earned),
    pointsBonus: num(row.points_bonus),
    pointsAdjusted: num(row.points_adjusted),
    pointsRedeemed: num(row.points_redeemed),
    valueRedeemedCents: num(row.value_redeemed_cents),
    membersTotal: num(row.members_total),
    membersNew: num(row.members_new),
    memberSalesCount: num(row.member_sales_count),
    memberSalesCents: num(row.member_sales_cents),
    allSalesCents: num(row.all_sales_cents),
    topMembers: list(row.top_members).map((m) => ({
      name: String(m.name ?? ""),
      salesCents: num(m.sales_cents),
      pointsBalance: num(m.points_balance),
    })),
    topBonusProducts: list(row.top_bonus_products).map((p) => ({
      productName: String(p.product_name ?? ""),
      bonusPoints: num(p.bonus_points),
    })),
  };
}

// Share of the period's sales that came from members, in percent (one decimal);
// null when nothing was sold.
export function memberSalesShare(report: LoyaltyReport): number | null {
  if (!(report.allSalesCents > 0)) return null;
  const share = (Math.max(0, report.memberSalesCents) / report.allSalesCents) * 100;
  return Math.round(share * 10) / 10;
}
