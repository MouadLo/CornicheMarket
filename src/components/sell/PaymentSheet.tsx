import { useEffect, useRef, useState } from "react";
import { Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";

import { BigButton } from "@/src/components/BigButton";
import { BarcodeScannerModal } from "@/src/components/products/BarcodeScannerModal";
import { cardTokenFromScan } from "@/src/lib/loyalty/card";
import { pointsText, valueAndPoints } from "@/src/lib/loyalty/display";
import {
  maxRedeemablePoints,
  pointsValueCents,
  stepRedeemPoints,
  type LoyaltyRates,
} from "@/src/lib/loyalty/points";
import type { RedeemCheck, RedeemRefusal } from "@/src/lib/loyalty/queries";
import { centsToDisplay, formatMAD, parseMoneyToCents } from "@/src/lib/money";
import { filterCustomers, findCustomerByName, pressCashKey } from "@/src/lib/sales/cashEntry";
import {
  DEFAULT_CREDIT_LIMIT_CENTS,
  creditLimitProblem,
  customerCreditState,
} from "@/src/lib/sales/creditLimit";
import { paymentMethodKey } from "@/src/lib/sales/paymentMethod";
import { changeDue, isShortPayment } from "@/src/lib/sales/totals";
import { isScannerBurst, keyFromKeyboardEvent, type WeightKey } from "@/src/lib/sales/weightEntry";
import type { Customer, PaymentMethod } from "@/src/lib/sales/queries";
import { isolateBidi, isolateLtr } from "@/src/lib/text/bidi";
import { colors, radius, touch } from "@/src/theme/tokens";
import { Banner } from "@/src/components/ui/Banner";
import { Chip } from "@/src/components/ui/Chip";
import { Text } from "@/src/theme/Text";

// What the sheet needs to let a loyalty member pay with points. Present only
// when the member is known online (the balance and the card are checked live).
export type PaymentLoyalty = {
  customerId: string;
  balance: number; // points
  // What points may pay for: the eligible lines, after their own discounts and
  // never more than what is due. Excluded items and Divers are not in it.
  eligibleCents: number;
  rates: LoyaltyRates;
  // The card QR already scanned for this sale (the proof), if any.
  cardToken: string | null;
  // Whether this device can scan the card here (camera); otherwise it must be
  // scanned before paying (USB scanner on the Sell screen).
  canScan: boolean;
  resolveCard: (token: string) => Promise<{ customerId: string } | null>;
  checkRedeem: (
    customerId: string,
    points: number,
    cardToken: string | null
  ) => Promise<RedeemCheck>;
};

export type PaymentRedemption = { points: number; cardToken: string | null };

type Props = {
  visible: boolean;
  totalCents: number;
  customers: Customer[];
  saving: boolean;
  error: string | null;
  onClose: () => void;
  // change: what to hand back (cash only; 0 for an exact amount or any other method).
  // redemption: only passed when points are being spent (never as a 4th
  // argument otherwise).
  onConfirm: (
    method: PaymentMethod,
    customerId: string | null,
    change: number,
    redemption?: PaymentRedemption
  ) => void;
  onCreateCustomer: (name: string) => Promise<Customer | null>;
  // The owner is not limited on customer debt: they see the same figures and a
  // note, but Pay Later is never disabled for them.
  isOwner?: boolean;
  // The store's default debt limit, for a customer with no limit of their own.
  storeCreditLimitCents?: number;
  loyalty?: PaymentLoyalty;
  // A loyalty member is attached to the sale: a credit sale is theirs and
  // nobody else's. customerId is null when it cannot be told which customer
  // they are (attached offline by phone and not in the customer list).
  loyaltyCredit?: { customerId: string | null; name: string };
};

const METHODS: PaymentMethod[] = ["cash", "card", "credit"];

// Past this many customers the list gets a search box.
const SEARCH_FROM = 6;

const KEY_ROWS: WeightKey[][] = [
  ["7", "8", "9"],
  ["4", "5", "6"],
  ["1", "2", "3"],
  [".", "0", "back"],
];

export function PaymentSheet({
  visible,
  totalCents,
  customers,
  saving,
  error,
  onClose,
  onConfirm,
  onCreateCustomer,
  isOwner = false,
  storeCreditLimitCents = DEFAULT_CREDIT_LIMIT_CENTS,
  loyalty,
  loyaltyCredit,
}: Props) {
  const { t } = useTranslation();
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [tendered, setTendered] = useState("");
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [newCustomer, setNewCustomer] = useState("");
  const [search, setSearch] = useState("");
  const [cardDeclined, setCardDeclined] = useState(false);
  // Loyalty: points being spent (0 = none), the card scanned as proof, and what
  // the cashier is told about them.
  const [points, setPoints] = useState(0);
  const [proofToken, setProofToken] = useState<string | null>(loyalty?.cardToken ?? null);
  const [scanning, setScanning] = useState(false);
  const [proofError, setProofError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  // The sheet stays mounted between sales, so its state would otherwise carry
  // over: after a credit sale the next customer's sheet opened on "Pay later"
  // with the previous customer selected, one tap from putting a stranger's
  // basket on their credit. Every opening starts from cash, no customer, no
  // amount. Done while rendering (not in an effect) so a stale choice is never
  // painted, even for one frame.
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setMethod("cash");
      setTendered("");
      setCustomerId(null);
      setNewCustomer("");
      setSearch("");
      setCardDeclined(false);
      setPoints(0);
      setProofToken(loyalty?.cardToken ?? null);
      setScanning(false);
      setProofError(null);
      setChecking(false);
      setRefusal(null);
    }
  }

  // Points: never more than the balance, never more than the eligible items
  // cost; their value comes off what is due.
  const maxPoints = loyalty
    ? maxRedeemablePoints(loyalty.balance, loyalty.eligibleCents, loyalty.rates)
    : 0;
  const usedPoints = loyalty && maxPoints > 0 ? Math.min(points, maxPoints) : 0;
  const pointsValue = loyalty ? pointsValueCents(usedPoints, loyalty.rates) : 0;
  const dueCents = Math.max(0, totalCents - pointsValue);
  const needsProof = usedPoints > 0 && !proofToken;

  const tenderedCents = parseMoneyToCents(tendered) ?? 0;
  const short = method === "cash" && tendered !== "" && isShortPayment(tenderedCents, dueCents);
  const change = changeDue(tenderedCents, dueCents);
  // With a loyalty member on the sale, a credit sale is theirs: nobody else can
  // be picked (a sale never carries a member different from its debtor).
  const debtorId = loyaltyCredit ? loyaltyCredit.customerId : customerId;
  const chosen = customers.find((customer) => customer.id === debtorId) ?? null;
  const needsCustomer = method === "credit" && !chosen;
  // What the customer already owes against their limit, and whether this sale
  // would go over it. The device blocks a cashier here (it works offline); the
  // server only flags a breach.
  const credit =
    method === "credit" && chosen ? customerCreditState(chosen, storeCreditLimitCents) : null;
  const creditProblem = credit
    ? creditLimitProblem(credit.balanceCents, dueCents, credit.limitCents)
    : null;
  const creditBlocked = !isOwner && creditProblem !== null;

  // Physical keyboard on web: digits, the decimal point and Backspace fill the
  // cash amount. Enter is left alone (a scanner ends with it), and keys that
  // arrive scanner-fast are ignored.
  const active = visible && method === "cash";
  const lastKeyAt = useRef<number | null>(null);
  useEffect(() => {
    if (!active || Platform.OS !== "web" || typeof document === "undefined") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const key = keyFromKeyboardEvent(event.key);
      if (key === null || key === "enter" || key === "escape") return;
      const scanned =
        key !== "back" && (event.repeat || isScannerBurst(lastKeyAt.current, event.timeStamp));
      lastKeyAt.current = event.timeStamp;
      event.preventDefault();
      if (!scanned) setTendered((current) => pressCashKey(current, key));
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [active]);

  const handleCreateCustomer = async () => {
    const name = newCustomer.trim();
    if (!name) return;
    // Typing someone who already exists selects them: a second record would
    // split their debt in two.
    const existing = findCustomerByName(customers, name);
    if (existing) {
      setCustomerId(existing.id);
      setNewCustomer("");
      return;
    }
    const created = await onCreateCustomer(name);
    if (created) {
      setCustomerId(created.id);
      setNewCustomer("");
    }
  };

  const shown = filterCustomers(customers, search);

  const refusalText = (reason: RedeemRefusal | null): string => {
    switch (reason) {
      case "disabled":
        return t("loyalty.refuseDisabled");
      case "not_member":
        return t("loyalty.refuseNotMember");
      case "no_proof":
        return t("loyalty.refuseNoProof");
      case "below_minimum":
        return t("loyalty.refuseBelowMinimum", {
          points: pointsText(t, loyalty?.rates.minRedeemPoints ?? 0),
        });
      case "over_balance":
        return t("loyalty.refuseOverBalance");
      default:
        return t("loyalty.payCheckFailed");
    }
  };

  // Every way of completing the sale comes through here. Points are checked with
  // the server first (balance, proof, minimum); a refusal stops the payment and
  // the cashier can take the points off and pay normally. Without points this is
  // exactly the plain confirm.
  const submit = async (
    payMethod: PaymentMethod,
    payCustomerId: string | null,
    payChange: number
  ) => {
    if (!loyalty || usedPoints <= 0) {
      onConfirm(payMethod, payCustomerId, payChange);
      return;
    }
    if (checking) return;
    setRefusal(null);
    setChecking(true);
    let check: RedeemCheck;
    try {
      check = await loyalty.checkRedeem(loyalty.customerId, usedPoints, proofToken);
    } catch {
      setChecking(false);
      setRefusal(t("loyalty.payCheckFailed"));
      return;
    }
    setChecking(false);
    if (!check.ok) {
      setRefusal(refusalText(check.reason));
      return;
    }
    onConfirm(payMethod, payCustomerId, payChange, { points: usedPoints, cardToken: proofToken });
  };

  const onCardScanned = async (raw: string) => {
    setScanning(false);
    setProofError(null);
    const token = cardTokenFromScan(raw);
    if (!token) {
      setProofError(t("loyalty.payScanNotCard"));
      return;
    }
    try {
      const found = await loyalty?.resolveCard(token);
      if (!found) setProofError(t("loyalty.payScanUnknown"));
      else if (found.customerId !== loyalty?.customerId) {
        setProofError(t("loyalty.payScanWrongCustomer"));
      } else setProofToken(token);
    } catch {
      setProofError(t("loyalty.payScanFailed"));
    }
  };

  const confirmLabel = saving
    ? t("common.saving")
    : method === "credit" && chosen
      ? t("sell.putOnCredit", {
          amount: isolateLtr(formatMAD(dueCents)),
          name: isolateBidi(chosen.name),
        })
      : checking
        ? t("loyalty.payChecking")
        : t("sell.completeSale");

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.sheetContent}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={styles.total}>{formatMAD(dueCents)}</Text>

            {loyalty && maxPoints > 0 ? (
              <View style={styles.pointsBox} testID="loyalty-redeem">
                {usedPoints === 0 ? (
                  <Pressable
                    accessibilityRole="button"
                    style={styles.pointsRow}
                    onPress={() => setPoints(maxPoints)}
                  >
                    <Text style={styles.pointsTitle}>{t("loyalty.payUse")}</Text>
                    <Text style={styles.pointsUpTo}>
                      {t("loyalty.payUpTo", {
                        value: isolateLtr(formatMAD(pointsValueCents(maxPoints, loyalty.rates))),
                        points: pointsText(t, maxPoints),
                      })}
                    </Text>
                  </Pressable>
                ) : (
                  <>
                    <Text style={styles.pointsTitle}>{t("loyalty.payUse")}</Text>
                    <View style={styles.stepper}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t("loyalty.payMinus")}
                        testID="points-minus"
                        style={styles.stepButton}
                        onPress={() =>
                          setPoints(stepRedeemPoints(usedPoints, "down", maxPoints, loyalty.rates))
                        }
                      >
                        <Text style={styles.stepText}>−</Text>
                      </Pressable>
                      <Text style={styles.pointsValue} testID="points-value">
                        {valueAndPoints(t, usedPoints, loyalty.rates.pointValueCents)}
                      </Text>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t("loyalty.payPlus")}
                        testID="points-plus"
                        style={styles.stepButton}
                        onPress={() =>
                          setPoints(stepRedeemPoints(usedPoints, "up", maxPoints, loyalty.rates))
                        }
                      >
                        <Text style={styles.stepText}>+</Text>
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        testID="points-max"
                        style={styles.maxButton}
                        onPress={() => setPoints(maxPoints)}
                      >
                        <Text style={styles.maxText}>{t("loyalty.payMax")}</Text>
                      </Pressable>
                    </View>
                    <Text style={styles.pointsUpTo}>
                      {t("loyalty.payUpTo", {
                        value: isolateLtr(formatMAD(pointsValueCents(maxPoints, loyalty.rates))),
                        points: pointsText(t, maxPoints),
                      })}
                    </Text>
                    <View style={styles.discountLine} testID="points-discount-line">
                      <Text style={styles.pointsTitle}>{t("loyalty.payLine")}</Text>
                      <Text style={styles.pointsTitle}>{`−${formatMAD(pointsValue)}`}</Text>
                    </View>
                    {proofToken ? (
                      <Text style={styles.proofOk} testID="points-proof-ok">
                        {t("loyalty.payProofOk")}
                      </Text>
                    ) : loyalty.canScan ? (
                      <BigButton
                        label={t("loyalty.payScanCard")}
                        variant="secondary"
                        onPress={() => {
                          setProofError(null);
                          setScanning(true);
                        }}
                      />
                    ) : (
                      <Text style={styles.hint}>{t("loyalty.payScanHint")}</Text>
                    )}
                    {proofError ? <Text style={styles.error}>{proofError}</Text> : null}
                    <Pressable
                      accessibilityRole="button"
                      style={styles.removePoints}
                      onPress={() => {
                        setPoints(0);
                        setRefusal(null);
                      }}
                    >
                      <Text style={styles.removePointsText}>{t("loyalty.payRemove")}</Text>
                    </Pressable>
                  </>
                )}
              </View>
            ) : null}

            <View style={styles.methods}>
              {METHODS.map((value) => (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: method === value }}
                  key={value}
                  style={[styles.method, method === value && styles.methodActive]}
                  onPress={() => {
                    setMethod(value);
                    setCardDeclined(false);
                  }}
                >
                  <Text style={[styles.methodText, method === value && styles.methodTextActive]}>
                    {value === "credit" ? t("sell.payLater") : t(paymentMethodKey(value))}
                  </Text>
                </Pressable>
              ))}
            </View>

            {method === "cash" && (
              <View style={styles.block}>
                <Text style={styles.label}>{t("sell.cashReceived")}</Text>
                {/* Not a text field: the system keyboard would cover the sheet. */}
                <View style={styles.display}>
                  <Text
                    testID="cash-entry"
                    style={[styles.entry, tendered === "" && styles.entryEmpty]}
                  >
                    {tendered === "" ? "—" : tendered}
                  </Text>
                  <Text style={styles.unit}>DH</Text>
                </View>
                {short ? (
                  <Text style={styles.short}>
                    {t("sell.shortBy", {
                      amount: isolateLtr(formatMAD(dueCents - tenderedCents)),
                    })}
                  </Text>
                ) : (
                  <View style={styles.changeBox}>
                    <Text style={styles.changeLabel}>{t("sell.change")}</Text>
                    <Text style={styles.changeValue}>{formatMAD(change)}</Text>
                  </View>
                )}

                <View style={styles.quickRow}>
                  <Pressable
                    accessibilityRole="button"
                    style={[styles.quick, styles.quickExact]}
                    onPress={() => setTendered(centsToDisplay(dueCents))}
                  >
                    <Text style={[styles.quickText, styles.quickExactText]}>
                      {t("sell.exactAmount")}
                    </Text>
                  </Pressable>
                  {quickAmounts(dueCents).map((amount) => (
                    <Pressable
                      accessibilityRole="button"
                      key={amount}
                      style={styles.quick}
                      onPress={() => setTendered(centsToDisplay(amount))}
                    >
                      <Text style={styles.quickText}>{centsToDisplay(amount)}</Text>
                    </Pressable>
                  ))}
                </View>

                {KEY_ROWS.map((row) => (
                  <View key={row.join("")} style={styles.keyRow}>
                    {row.map((key) => (
                      <Pressable
                        key={key}
                        testID={`cash-key-${key}`}
                        accessibilityRole="button"
                        accessibilityLabel={key === "back" ? t("common.back") : key}
                        style={({ pressed }) => [styles.key, pressed && styles.keyPressed]}
                        onPress={() => setTendered((current) => pressCashKey(current, key))}
                      >
                        <Text style={styles.keyText}>{key === "back" ? "⌫" : key}</Text>
                      </Pressable>
                    ))}
                  </View>
                ))}
              </View>
            )}

            {method === "card" && (
              <View style={styles.block}>
                <Text style={styles.cardInstruction}>
                  {t("sell.cardInstruction", { amount: isolateLtr(formatMAD(dueCents)) })}
                </Text>
              </View>
            )}

            {method === "credit" && (
              <View style={styles.block}>
                {loyaltyCredit ? (
                  <Text style={styles.hint} testID="credit-locked">
                    {chosen
                      ? t("loyalty.payCreditLocked", { name: isolateBidi(loyaltyCredit.name) })
                      : t("loyalty.payCreditUnknown")}
                  </Text>
                ) : (
                  <Text style={styles.label}>{t("sell.whoPaysLater")}</Text>
                )}
                {!loyaltyCredit && customers.length > SEARCH_FROM && (
                  <TextInput
                    style={styles.input}
                    value={search}
                    onChangeText={setSearch}
                    placeholder={t("sell.searchCustomer")}
                    accessibilityLabel={t("sell.searchCustomer")}
                  />
                )}
                <View style={styles.customers}>
                  {(loyaltyCredit ? [] : shown).map((customer) => {
                    const owed = customer.balance_cents ?? 0;
                    const selected = customerId === customer.id;
                    return (
                      <Chip
                        key={customer.id}
                        label={customer.name}
                        alert={
                          owed > 0
                            ? t("sell.owes", { amount: isolateLtr(formatMAD(owed)) })
                            : undefined
                        }
                        selected={selected}
                        onPress={() => setCustomerId(customer.id)}
                      />
                    );
                  })}
                  {!loyaltyCredit && shown.length === 0 && (
                    <Text style={styles.hint}>{t("sell.noCustomerFound")}</Text>
                  )}
                </View>

                {credit && (
                  <View style={styles.block}>
                    <Text style={styles.hint} testID="credit-standing">
                      {t("sell.creditStanding", {
                        owed: isolateLtr(formatMAD(Math.max(0, credit.balanceCents))),
                        limit: isolateLtr(formatMAD(credit.limitCents)),
                      })}
                    </Text>
                    {creditProblem && !isOwner && (
                      <Text style={styles.error} testID="credit-blocked">
                        {creditProblem.kind === "noCredit"
                          ? t("sell.creditNone")
                          : t("sell.creditOver", {
                              amount: isolateLtr(formatMAD(creditProblem.availableCents)),
                            })}
                      </Text>
                    )}
                    {creditProblem && isOwner && (
                      <Text style={styles.hint} testID="credit-owner-note">
                        {t("sell.creditOwnerMayExceed")}
                      </Text>
                    )}
                  </View>
                )}

                {!loyaltyCredit ? (
                  <View style={styles.newCustomerRow}>
                    <TextInput
                      style={[styles.input, styles.flex]}
                      value={newCustomer}
                      onChangeText={setNewCustomer}
                      placeholder={t("sell.newCustomerName")}
                      accessibilityLabel={t("sell.newCustomerName")}
                    />
                    <Pressable
                      accessibilityRole="button"
                      style={styles.addCustomer}
                      onPress={handleCreateCustomer}
                    >
                      <Text style={styles.addCustomerText}>{t("common.add")}</Text>
                    </Pressable>
                  </View>
                ) : null}
              </View>
            )}

            {error && <Text style={styles.error}>{error}</Text>}
            {refusal && (
              <Text style={styles.error} testID="points-refusal">
                {refusal}
              </Text>
            )}
          </ScrollView>

          {/* Pinned: Complete sale is always in the same place, whatever the method. */}
          <View style={styles.footer}>
            {needsCustomer && !loyaltyCredit && (
              <Text style={styles.hint}>{t("sell.chooseCustomer")}</Text>
            )}
            {needsProof && <Text style={styles.hint}>{t("loyalty.payNeedProof")}</Text>}
            {method === "card" ? (
              <>
                <View accessibilityLiveRegion="polite">
                  {cardDeclined && <Banner tone="bad" text={t("sell.cardDeclinedMessage")} />}
                </View>
                <BigButton
                  label={saving ? t("common.saving") : t("sell.cardAccepted")}
                  variant="pay"
                  tall
                  onPress={() => void submit("card", debtorId, 0)}
                  disabled={saving || checking || needsProof}
                />
                <View style={styles.declineGap}>
                  <BigButton
                    label={t("sell.cardDeclined")}
                    variant="secondary"
                    onPress={() => setCardDeclined(true)}
                    disabled={saving}
                  />
                </View>
              </>
            ) : (
              <BigButton
                label={confirmLabel}
                variant="pay"
                tall
                onPress={() =>
                  void submit(
                    method,
                    method === "credit" ? debtorId : customerId,
                    method === "cash" ? change : 0
                  )
                }
                disabled={
                  saving ||
                  checking ||
                  needsProof ||
                  needsCustomer ||
                  short ||
                  (method === "credit" && creditBlocked)
                }
              />
            )}
            <Pressable style={styles.back} onPress={onClose} accessibilityRole="button">
              <Text style={styles.backText}>{t("common.back")}</Text>
            </Pressable>
          </View>
        </View>
        {loyalty ? (
          <BarcodeScannerModal
            visible={scanning}
            onClose={() => setScanning(false)}
            onScanned={(code) => void onCardScanned(code)}
          />
        ) : null}
      </View>
    </Modal>
  );
}

// Notes a customer is likely to hand over above this total (the exact amount has its own button).
function quickAmounts(totalCents: number): number[] {
  const notes = [2000, 5000, 10000, 20000];
  return notes.filter((note) => note > totalCents).slice(0, 3);
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  // A centred panel (like the weight keypad), not the full width: the basket
  // stays visible behind it on a wide screen.
  sheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "96%",
    width: "100%",
    maxWidth: 480,
    alignSelf: "center",
  },
  body: { flexShrink: 1 },
  sheetContent: { padding: 20, paddingBottom: 8, gap: 12 },
  total: { fontSize: 34, fontWeight: "800", textAlign: "center" },
  methods: { flexDirection: "row", gap: 8 },
  method: {
    flex: 1,
    minHeight: touch.lg,
    justifyContent: "center",
    borderRadius: radius.control,
    backgroundColor: colors.divider,
    alignItems: "center",
  },
  methodActive: { backgroundColor: colors.brand700 },
  methodText: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.ink700,
    textTransform: "capitalize",
  },
  methodTextActive: { color: colors.white },
  block: { gap: 10 },
  label: { fontSize: 14, fontWeight: "600", color: colors.ink700 },
  input: {
    minHeight: 56,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.ink400,
    paddingHorizontal: 16,
    fontSize: 20,
  },
  flex: { flex: 1 },
  display: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "baseline",
    gap: 8,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.ink400,
    paddingVertical: 8,
  },
  entry: { fontSize: 40, fontWeight: "800" },
  entryEmpty: { color: colors.ink400 },
  unit: { fontSize: 20, fontWeight: "600", color: colors.ink600 },
  quickRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  quick: {
    flexGrow: 1,
    minHeight: touch.lg,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    borderRadius: radius.control,
    backgroundColor: colors.brand100,
  },
  quickExact: { backgroundColor: colors.brand700 },
  quickExactText: { color: colors.white },
  quickText: { fontSize: 18, fontWeight: "700", color: colors.brand700 },
  keyRow: { flexDirection: "row", gap: 8 },
  key: {
    flex: 1,
    minHeight: touch.lg,
    borderRadius: radius.control,
    backgroundColor: colors.brand100,
    alignItems: "center",
    justifyContent: "center",
  },
  keyPressed: { opacity: 0.7 },
  keyText: { fontSize: 24, fontWeight: "700", color: colors.ink900 },
  changeBox: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: colors.brand50,
    borderRadius: radius.control,
    padding: 14,
  },
  changeLabel: { fontSize: 16, fontWeight: "600" },
  changeValue: { fontSize: 26, fontWeight: "800", color: colors.success700 },
  short: { color: colors.danger600, fontSize: 16, fontWeight: "600" },
  customers: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  newCustomerRow: { flexDirection: "row", gap: 8 },
  addCustomer: {
    paddingHorizontal: 20,
    borderRadius: radius.control,
    backgroundColor: colors.brand700,
    alignItems: "center",
    justifyContent: "center",
  },
  addCustomerText: { color: colors.white, fontWeight: "700", fontSize: 15 },
  error: { color: colors.danger600, fontSize: 15 },
  footer: {
    padding: 20,
    paddingTop: 10,
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  cardInstruction: { fontSize: 17, fontWeight: "600", color: colors.ink900, textAlign: "center" },
  declineGap: { marginTop: 12 },
  pointsBox: {
    gap: 8,
    padding: 14,
    borderRadius: radius.control,
    backgroundColor: colors.brand50,
    borderWidth: 1,
    borderColor: colors.brand100,
  },
  pointsRow: { gap: 2, minHeight: touch.min, justifyContent: "center" },
  pointsTitle: { fontSize: 16, fontWeight: "700", color: colors.brand700 },
  pointsUpTo: { fontSize: 14, color: colors.ink700 },
  stepper: { flexDirection: "row", alignItems: "center", gap: 8 },
  stepButton: {
    minHeight: touch.min,
    minWidth: touch.min,
    borderRadius: radius.control,
    backgroundColor: colors.brand100,
    alignItems: "center",
    justifyContent: "center",
  },
  stepText: { fontSize: 24, fontWeight: "700", color: colors.brand700 },
  pointsValue: { flex: 1, fontSize: 17, fontWeight: "800", textAlign: "center" },
  maxButton: {
    minHeight: touch.min,
    paddingHorizontal: 14,
    borderRadius: radius.control,
    backgroundColor: colors.brand700,
    alignItems: "center",
    justifyContent: "center",
  },
  maxText: { fontSize: 15, fontWeight: "700", color: colors.white },
  discountLine: { flexDirection: "row", justifyContent: "space-between" },
  proofOk: { fontSize: 15, fontWeight: "600", color: colors.success700 },
  removePoints: { minHeight: touch.min, justifyContent: "center", alignSelf: "flex-start" },
  removePointsText: { fontSize: 15, fontWeight: "600", color: colors.danger700 },
  hint: { fontSize: 15, color: colors.ink600, textAlign: "center" },
  // Small and apart from Complete sale: a slip must not leave the payment.
  back: { minHeight: touch.min, alignItems: "center", justifyContent: "center", marginTop: 8 },
  backText: { fontSize: 16, fontWeight: "600", color: colors.ink600 },
});
