import { useEffect, useState } from "react";
import {
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  TextInput,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";

import { BigButton } from "@/src/components/BigButton";
import { InlineError } from "@/src/components/ui/InlineError";
import { cardUrl, whatsappCardLink } from "@/src/lib/loyalty/card";
import { loyaltyErrorKey } from "@/src/lib/loyalty/errors";
import { appOrigin } from "@/src/lib/loyalty/origin";
import { formatMaPhone, normalizeMaPhone } from "@/src/lib/loyalty/phone";
import { loyaltyJoin, loyaltyLookup } from "@/src/lib/loyalty/queries";
import type { SaleMember } from "@/src/lib/loyalty/saleMember";
import { isolateLtr } from "@/src/lib/text/bidi";
import { Banner } from "@/src/components/ui/Banner";
import { Text } from "@/src/theme/Text";
import { colors, radius } from "@/src/theme/tokens";

type Props = {
  visible: boolean;
  online: boolean;
  onClose: () => void;
  // The member is attached to the sale as soon as it is known (found, or just
  // enrolled), before the panel closes: the cashier may still send the card.
  onAttach: (member: SaleMember) => void;
};

type Step = "phone" | "join" | "joined";

// Attach a loyalty member to the sale being rung up: type the phone, find them
// (or enrol them with their consent), then offer to send their card. Offline
// nothing can be looked up: the number is attached as typed and the server
// awards the points when the sale syncs.
export function SaleLoyaltyPanel({ visible, online, onClose, onAttach }: Props) {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The lookup failed on a connection that looked fine: the number can still
  // be attached the offline way.
  const [lookupFailed, setLookupFailed] = useState(false);
  const [card, setCard] = useState<{ token: string; phone: string } | null>(null);

  useEffect(() => {
    if (!visible) return;
    setStep("phone");
    setPhone("");
    setName("");
    setConsent(false);
    setBusy(false);
    setError(null);
    setLookupFailed(false);
    setCard(null);
  }, [visible]);

  const normalized = normalizeMaPhone(phone);

  const attachOffline = () => {
    if (!normalized) return setError("loyalty.errPhone");
    onAttach({
      customerId: null,
      phone: normalized,
      name: null,
      balance: null,
      cardToken: null,
      pending: true,
    });
    onClose();
  };

  const find = async () => {
    setError(null);
    setLookupFailed(false);
    if (!normalized) return setError("loyalty.errPhone");
    setBusy(true);
    try {
      const found = await loyaltyLookup(normalized);
      if (found?.isMember) {
        onAttach({
          customerId: found.customerId,
          phone: normalized,
          name: found.name || null,
          balance: found.balance,
          cardToken: null,
          pending: false,
        });
        onClose();
        return;
      }
      // A customer who is not a member yet, or an unknown number: enrol them.
      setName(found?.name ?? "");
      setStep("join");
    } catch {
      setError("loyalty.sellLookupFailed");
      setLookupFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const join = async () => {
    setError(null);
    if (!normalized) return setError("loyalty.errPhone");
    if (!consent) return setError("loyalty.errConsent");
    setBusy(true);
    try {
      const result = await loyaltyJoin(normalized, name.trim() || null, true);
      onAttach({
        customerId: result.customerId,
        phone: normalized,
        name: result.name || null,
        balance: result.balance,
        cardToken: null,
        pending: false,
      });
      setCard({ token: result.cardToken, phone: normalized });
      setStep("joined");
    } catch (failure) {
      setError(loyaltyErrorKey(failure, "loyalty.errEnrol"));
    } finally {
      setBusy(false);
    }
  };

  const sendCard = () => {
    setError(null);
    if (!card) return;
    const origin = appOrigin();
    if (!origin) return setError("loyalty.errNoOrigin");
    Linking.openURL(
      whatsappCardLink(
        card.phone,
        t("loyalty.whatsappMessage", { url: cardUrl(origin, card.token) })
      )
    ).catch(() => setError("loyalty.errShare"));
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <ScrollView
          style={styles.sheet}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.title}>{t("loyalty.sellTitle")}</Text>

          {step === "phone" ? (
            <>
              {!online ? <Banner tone="warn" text={t("loyalty.sellOfflineHint")} /> : null}
              <Text style={styles.label}>{t("loyalty.sellPhoneLabel")}</Text>
              <TextInput
                style={styles.input}
                value={phone}
                onChangeText={setPhone}
                keyboardType="phone-pad"
                placeholder="06 12 34 56 78"
                accessibilityLabel={t("loyalty.sellPhoneLabel")}
                autoFocus
                onSubmitEditing={online ? find : attachOffline}
              />
              {normalized ? (
                <Text style={styles.formatted} testID="loyalty-phone-formatted">
                  {isolateLtr(formatMaPhone(normalized))}
                </Text>
              ) : null}
              {error ? <InlineError reasonKey={error} /> : null}
              {online ? (
                <BigButton
                  label={busy ? t("loyalty.sellFinding") : t("loyalty.sellFind")}
                  onPress={find}
                  disabled={busy || !normalized}
                />
              ) : null}
              {!online || lookupFailed ? (
                <BigButton
                  label={t("loyalty.sellAttachOffline")}
                  variant={online ? "secondary" : "primary"}
                  onPress={attachOffline}
                  disabled={!normalized}
                />
              ) : null}
            </>
          ) : null}

          {step === "join" ? (
            <>
              <Text style={styles.hint}>{t("loyalty.sellJoinHint")}</Text>
              {normalized ? (
                <Text style={styles.formatted}>{isolateLtr(formatMaPhone(normalized))}</Text>
              ) : null}
              <Text style={styles.label}>{t("loyalty.sellNameLabel")}</Text>
              <TextInput
                style={styles.input}
                value={name}
                onChangeText={setName}
                placeholder=""
                accessibilityLabel={t("loyalty.sellNameLabel")}
                maxLength={80}
              />
              <View style={styles.switchRow}>
                <Text style={styles.switchLabel}>{t("loyalty.sellConsent")}</Text>
                <Switch
                  value={consent}
                  onValueChange={setConsent}
                  accessibilityLabel={t("loyalty.sellConsent")}
                />
              </View>
              {error ? <InlineError reasonKey={error} /> : null}
              <BigButton
                label={busy ? t("loyalty.sellJoining") : t("loyalty.sellJoinButton")}
                onPress={join}
                disabled={busy}
              />
            </>
          ) : null}

          {step === "joined" ? (
            <>
              <Text style={styles.hint}>{t("loyalty.cardReady")}</Text>
              {error ? <InlineError reasonKey={error} /> : null}
              <BigButton label={t("loyalty.shareWhatsapp")} onPress={sendCard} />
            </>
          ) : null}

          <Pressable accessibilityRole="button" style={styles.close} onPress={onClose}>
            <Text style={styles.closeText}>
              {step === "joined" ? t("common.close") : t("common.cancel")}
            </Text>
          </Pressable>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  // Near the top: the phone keyboard must not cover the field being typed in.
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-start",
    alignItems: "center",
    paddingTop: 48,
  },
  sheet: {
    width: "100%",
    maxWidth: 420,
    flexGrow: 0,
    maxHeight: "90%",
    backgroundColor: colors.white,
    borderRadius: 20,
  },
  content: { padding: 20, gap: 12 },
  title: { fontSize: 20, fontWeight: "800", color: colors.ink900 },
  label: { fontSize: 14, fontWeight: "600", color: colors.ink700 },
  hint: { fontSize: 15, color: colors.ink700 },
  formatted: { fontSize: 18, fontWeight: "700", color: colors.brand700 },
  input: {
    minHeight: 56,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.ink400,
    paddingHorizontal: 16,
    fontSize: 20,
    backgroundColor: colors.white,
  },
  switchRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  switchLabel: { flex: 1, fontSize: 15, color: colors.ink700 },
  close: { minHeight: 48, alignItems: "center", justifyContent: "center" },
  closeText: { fontSize: 16, fontWeight: "600", color: colors.ink600 },
});
