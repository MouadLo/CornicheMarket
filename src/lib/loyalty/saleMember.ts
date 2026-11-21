// The loyalty member attached to the sale being rung up, and what the sale
// carries because of them. Pure: the Sell screen holds the state, the queue and
// the receipt only see these shapes.
import { normalizeMaPhone } from "@/src/lib/loyalty/phone";
import { pointsValueCents, type LoyaltyRates } from "@/src/lib/loyalty/points";
import type { PendingSale } from "@/src/lib/sales/offlineQueue";
import type { ReceiptLoyalty } from "@/src/lib/sales/receipt";

export type SaleMember = {
  // Known when the member was found online (lookup, join or card scan).
  customerId: string | null;
  // E.164, known when the cashier typed it or the member just joined.
  phone: string | null;
  name: string | null;
  // Points, null when unknown (attached offline).
  balance: number | null;
  // The card QR scanned for this sale: the proof to spend points.
  cardToken: string | null;
  // Attached offline by phone: the server awards the points when it syncs.
  pending: boolean;
};

export type SaleLoyalty = NonNullable<PendingSale["loyalty"]>;

export type Redemption = { points: number; cardToken: string | null };

// What goes to record_sale as p_loyalty. Undefined (so the key is absent and an
// old queued sale is unchanged) when there is no member. The card token is sent
// only with points to spend: it is a credential, nothing else needs it.
export function loyaltyPayload(
  member: SaleMember | null,
  redemption: Redemption | null
): SaleLoyalty | undefined {
  if (!member) return undefined;
  const payload: SaleLoyalty = {};
  if (member.customerId) payload.customer_id = member.customerId;
  else if (member.phone) payload.phone = member.phone;
  else return undefined;
  if (redemption && redemption.points > 0) {
    payload.redeem_points = redemption.points;
    if (redemption.cardToken) payload.card_token = redemption.cardToken;
  }
  return payload;
}

// The customer who pays a credit sale when a member is attached: always the
// member. Known directly online; offline only if the customer list holds
// someone with that phone. null = cannot be told (credit is not possible).
export function creditCustomerOfMember(
  member: SaleMember,
  customers: { id: string; phone: string | null }[]
): string | null {
  if (member.customerId) return member.customerId;
  if (!member.phone) return null;
  return (
    customers.find((c) => c.phone !== null && normalizeMaPhone(c.phone) === member.phone)?.id ??
    null
  );
}

// The loyalty block of the receipt, from what the device knows.
export function receiptLoyaltyOf(input: {
  member: SaleMember;
  redeemedPoints: number;
  earnedPoints: number;
  rates: LoyaltyRates;
}): ReceiptLoyalty {
  const { member, redeemedPoints, earnedPoints, rates } = input;
  const known = member.balance !== null && !member.pending;
  const after = known
    ? Math.max(0, (member.balance as number) - redeemedPoints + earnedPoints)
    : null;
  return {
    discountCents: pointsValueCents(redeemedPoints, rates),
    pointsEarned: earnedPoints,
    balanceAfterPoints: after,
    balanceAfterValueCents: after === null ? null : pointsValueCents(after, rates),
    pending: member.pending,
  };
}
