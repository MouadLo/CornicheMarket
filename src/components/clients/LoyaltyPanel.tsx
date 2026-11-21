import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Linking, StyleSheet, Switch, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";

import { BigButton } from "@/src/components/BigButton";
import { MemberBadge } from "@/src/components/loyalty/MemberBadge";
import { Banner } from "@/src/components/ui/Banner";
import { InlineError } from "@/src/components/ui/InlineError";
import { confirmDestructive } from "@/src/lib/confirmDestructive";
import { showToast } from "@/src/lib/dialog/store";
import { checkAdjustment } from "@/src/lib/loyalty/adjust";
import { cardUrl, whatsappCardLink } from "@/src/lib/loyalty/card";
import {
  ledgerLabelKey,
  pointsText,
  signedPoints,
  valueAndPoints,
} from "@/src/lib/loyalty/display";
import { loyaltyErrorKey } from "@/src/lib/loyalty/errors";
import { appOrigin } from "@/src/lib/loyalty/origin";
import { formatMaPhone, normalizeMaPhone } from "@/src/lib/loyalty/phone";
import {
  fetchIsMember,
  fetchLoyaltyLedger,
  fetchLoyaltySettings,
  fetchMemberDetails,
  loyaltyAdjust,
  loyaltyJoin,
  loyaltyResetCard,
  updateCustomerPhone,
  type LoyaltyJoinResult,
  type LoyaltyLedgerRow,
  type MemberDetails,
} from "@/src/lib/loyalty/queries";
import { DEFAULT_LOYALTY_SETTINGS } from "@/src/lib/loyalty/settings";
import { isolateBidi, isolateLtr } from "@/src/lib/text/bidi";
import { formatLocaleDate, formatLocaleTime } from "@/src/lib/text/dates";
import { Text } from "@/src/theme/Text";
import { colors, radius } from "@/src/theme/tokens";

const PAGE = 30;

type Props = {
  customerId: string;
  customerPhone: string | null;
  isOwner: boolean;
  timeZone: string;
  // The join landed on another customer (the number already belonged to one).
  onJoinedElsewhere?: (customerId: string) => void;
};

// The loyalty block of a customer's page. Everyone can enrol a customer and share
// the card link they just created. Only the owner sees phone, token, balance and
// history, and can adjust points or issue a new card: the database refuses
// anyone else, and a cashier is never even asked.
export function LoyaltyPanel({
  customerId,
  customerPhone,
  isOwner,
  timeZone,
  onJoinedElsewhere,
}: Props) {
  const { t, i18n } = useTranslation();
  const language = i18n?.language ?? "fr";

  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [isMember, setIsMember] = useState(false);
  const [pointValueCents, setPointValueCents] = useState(DEFAULT_LOYALTY_SETTINGS.pointValueCents);
  const [details, setDetails] = useState<MemberDetails | null>(null);
  const [ledger, setLedger] = useState<LoyaltyLedgerRow[]>([]);
  const [ledgerMore, setLedgerMore] = useState(false);
  // What a cashier can share: the card of the customer they enrolled just now.
  const [enrolled, setEnrolled] = useState<LoyaltyJoinResult | null>(null);
  const [enrolledPhone, setEnrolledPhone] = useState<string | null>(null);

  const [phone, setPhone] = useState(customerPhone ?? "");
  const [consent, setConsent] = useState(false);
  const [joining, setJoining] = useState(false);

  const [adjusting, setAdjusting] = useState(false);
  const [adjustPoints, setAdjustPoints] = useState("");
  const [adjustNote, setAdjustNote] = useState("");
  const [adjustBusy, setAdjustBusy] = useState(false);

  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [member, settings] = await Promise.all([
        fetchIsMember(customerId),
        fetchLoyaltySettings().catch(() => DEFAULT_LOYALTY_SETTINGS),
      ]);
      setIsMember(member);
      setPointValueCents(settings.pointValueCents);
      if (member && isOwner) {
        const [memberDetails, rows] = await Promise.all([
          fetchMemberDetails(customerId),
          fetchLoyaltyLedger(customerId, PAGE, 0),
        ]);
        setDetails(memberDetails);
        setLedger(rows);
        setLedgerMore(rows.length >= PAGE);
      }
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, [customerId, isOwner]);

  useEffect(() => {
    load();
  }, [load]);

  const loadMore = async () => {
    setError(null);
    try {
      const rows = await fetchLoyaltyLedger(customerId, PAGE, ledger.length);
      setLedger((current) => [...current, ...rows]);
      setLedgerMore(rows.length >= PAGE);
    } catch (failure) {
      setError(loyaltyErrorKey(failure, "loyalty.errLoad"));
    }
  };

  const enrol = async () => {
    setError(null);
    const normalized = normalizeMaPhone(phone);
    if (!normalized) return setError("loyalty.errPhone");
    if (!consent) return setError("loyalty.errConsent");
    setJoining(true);
    try {
      // Joining is by number: make sure this customer holds it, so the server
      // links them instead of creating a second customer.
      if (normalizeMaPhone(customerPhone ?? "") !== normalized) {
        await updateCustomerPhone(customerId, phone.trim());
      }
      const result = await loyaltyJoin(normalized, null, true);
      if (result.customerId !== customerId) {
        // The number already belonged to another customer: go to them.
        onJoinedElsewhere?.(result.customerId);
        return;
      }
      setEnrolled(result);
      setEnrolledPhone(normalized);
      setIsMember(true);
      showToast({ text: t("loyalty.enrolledToast"), tone: "success" });
      if (isOwner) await load();
    } catch (failure) {
      setError(loyaltyErrorKey(failure, "loyalty.errEnrol"));
    } finally {
      setJoining(false);
    }
  };

  const shareCard = (token: string | null, phoneE164: string | null) => {
    setError(null);
    const origin = appOrigin();
    if (!token || !phoneE164) return;
    if (!origin) return setError("loyalty.errNoOrigin");
    Linking.openURL(
      whatsappCardLink(phoneE164, t("loyalty.whatsappMessage", { url: cardUrl(origin, token) }))
    ).catch(() => setError("loyalty.errShare"));
  };

  const saveAdjustment = async () => {
    setError(null);
    const check = checkAdjustment(adjustPoints, adjustNote, details?.balance ?? 0);
    if (!check.ok) return setError(check.error);
    setAdjustBusy(true);
    try {
      await loyaltyAdjust(customerId, check.points, check.note);
      setAdjusting(false);
      setAdjustPoints("");
      setAdjustNote("");
      showToast({ text: t("loyalty.adjustedToast"), tone: "success" });
      await load();
    } catch (failure) {
      setError(loyaltyErrorKey(failure, "loyalty.errAdjustSave"));
    } finally {
      setAdjustBusy(false);
    }
  };

  const resetCard = async () => {
    setError(null);
    const ok = await confirmDestructive(
      t("loyalty.resetTitle"),
      t("loyalty.resetMessage"),
      t("loyalty.resetConfirm"),
      t("common.cancel")
    );
    if (!ok) return;
    try {
      const token = await loyaltyResetCard(customerId);
      setDetails((current) => (current ? { ...current, cardToken: token } : current));
      showToast({ text: t("loyalty.resetDoneToast"), tone: "success" });
    } catch (failure) {
      setError(loyaltyErrorKey(failure, "loyalty.errReset"));
    }
  };

  if (status === "loading") return <ActivityIndicator style={styles.loading} />;
  if (status === "error") {
    return (
      <Banner
        tone="warn"
        text={t("loyalty.errLoad")}
        action={{ label: t("common.retry"), onPress: load }}
      />
    );
  }

  const title = <Text style={styles.title}>{t("loyalty.panelTitle")}</Text>;

  // Not a member yet: phone and consent (cashier and owner alike).
  if (!isMember) {
    return (
      <View style={styles.box}>
        {title}
        <Text style={styles.meta}>{t("loyalty.enrollHint")}</Text>
        <TextInput
          style={styles.input}
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
          placeholder="06 12 34 56 78"
          accessibilityLabel={t("loyalty.phoneLabel")}
        />
        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>{t("loyalty.consentLabel")}</Text>
          <Switch
            value={consent}
            onValueChange={setConsent}
            accessibilityLabel={t("loyalty.consentLabel")}
          />
        </View>
        {error ? <InlineError reasonKey={error} /> : null}
        <BigButton
          label={joining ? t("loyalty.enrolling") : t("loyalty.enrollButton")}
          onPress={enrol}
          disabled={joining}
        />
      </View>
    );
  }

  // A member, seen by a cashier: the badge, and the card they just created.
  if (!isOwner) {
    return (
      <View style={styles.box}>
        {title}
        <MemberBadge />
        {enrolled ? (
          <>
            <Text style={styles.meta}>{t("loyalty.cardReady")}</Text>
            <BigButton
              label={t("loyalty.shareWhatsapp")}
              variant="secondary"
              onPress={() => shareCard(enrolled.cardToken, enrolledPhone)}
            />
          </>
        ) : (
          <Text style={styles.meta}>{t("loyalty.memberCashierNote")}</Text>
        )}
        {error ? <InlineError reasonKey={error} /> : null}
      </View>
    );
  }

  // The owner: balance, history and the actions.
  const balance = details?.balance ?? 0;
  return (
    <View style={styles.box}>
      {title}
      <MemberBadge />
      <Text style={styles.balance} testID="loyalty-balance">
        {valueAndPoints(t, balance, pointValueCents)}
      </Text>
      {details?.phoneE164 ? (
        <Text style={styles.meta}>
          {t("loyalty.phoneLabel")}: {isolateLtr(formatMaPhone(details.phoneE164))}
        </Text>
      ) : null}

      {adjusting ? (
        <View style={styles.adjustBox}>
          <TextInput
            style={styles.input}
            value={adjustPoints}
            onChangeText={setAdjustPoints}
            keyboardType="numbers-and-punctuation"
            placeholder="+50 / -50"
            accessibilityLabel={t("loyalty.adjustPoints")}
          />
          <TextInput
            style={styles.input}
            value={adjustNote}
            onChangeText={setAdjustNote}
            placeholder={t("loyalty.adjustNote")}
            accessibilityLabel={t("loyalty.adjustNote")}
            maxLength={200}
          />
          <BigButton
            label={adjustBusy ? t("loyalty.adjusting") : t("loyalty.adjustSave")}
            onPress={saveAdjustment}
            disabled={adjustBusy}
          />
          <BigButton
            label={t("common.cancel")}
            variant="secondary"
            onPress={() => {
              setAdjusting(false);
              setError(null);
            }}
          />
        </View>
      ) : (
        <BigButton
          label={t("loyalty.adjustButton")}
          variant="secondary"
          onPress={() => setAdjusting(true)}
        />
      )}

      <BigButton
        label={t("loyalty.shareWhatsapp")}
        variant="secondary"
        onPress={() => shareCard(details?.cardToken ?? null, details?.phoneE164 ?? null)}
      />
      <BigButton label={t("loyalty.resetButton")} variant="secondary" onPress={resetCard} />

      {error ? <InlineError reasonKey={error} /> : null}

      <Text style={styles.sectionLabel}>{t("loyalty.historyTitle")}</Text>
      {ledger.length === 0 ? <Text style={styles.meta}>{t("loyalty.historyEmpty")}</Text> : null}
      {ledger.map((entry) => {
        const when = new Date(entry.createdAt);
        return (
          <View key={entry.id} style={styles.entry}>
            <View style={styles.entryMain}>
              <Text style={styles.entryLabel}>{t(ledgerLabelKey(entry.kind, entry.note))}</Text>
              <Text style={styles.meta}>
                {formatLocaleDate(when, language, timeZone)} ·{" "}
                {formatLocaleTime(when, language, timeZone)}
              </Text>
              {entry.bonusPoints > 0 ? (
                <Text style={styles.meta}>
                  {t("loyalty.includesBonus", { points: pointsText(t, entry.bonusPoints) })}
                </Text>
              ) : null}
              {entry.kind === "adjust" && entry.note && entry.note !== "welcome" ? (
                <Text style={styles.meta}>{isolateBidi(entry.note)}</Text>
              ) : null}
            </View>
            <Text style={[styles.entryPoints, entry.points < 0 && styles.entryNegative]}>
              {signedPoints(entry.points)}
            </Text>
          </View>
        );
      })}
      {ledgerMore ? (
        <BigButton label={t("credit.loadMore")} variant="secondary" onPress={loadMore} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { marginVertical: 12 },
  box: { backgroundColor: colors.surface, borderRadius: radius.panel, padding: 16, gap: 10 },
  title: { fontSize: 16, fontWeight: "700", color: colors.ink900 },
  meta: { fontSize: 14, color: colors.ink600 },
  balance: { fontSize: 24, fontWeight: "800", color: colors.brand700 },
  input: {
    minHeight: 52,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.ink400,
    paddingHorizontal: 16,
    fontSize: 16,
    backgroundColor: colors.white,
  },
  switchRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  switchLabel: { flex: 1, fontSize: 14, color: colors.ink700 },
  adjustBox: { gap: 10 },
  sectionLabel: { fontSize: 14, fontWeight: "700", color: colors.ink600, marginTop: 6 },
  entry: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  entryMain: { flex: 1, gap: 2 },
  entryLabel: { fontSize: 15, fontWeight: "600", color: colors.ink900 },
  entryPoints: { fontSize: 17, fontWeight: "700", color: colors.success700 },
  entryNegative: { color: colors.danger600 },
});
