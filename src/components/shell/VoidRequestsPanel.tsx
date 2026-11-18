import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";

import { BigButton } from "@/src/components/BigButton";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { LoadQueryError } from "@/src/components/ui/LoadQueryError";
import { Money } from "@/src/components/ui/Money";
import { Panel } from "@/src/components/ui/Panel";
import { confirm, showToast } from "@/src/lib/dialog/store";
import { formatMAD } from "@/src/lib/money";
import { paymentMethodKey } from "@/src/lib/sales/paymentMethod";
import {
  decideVoidRequest,
  describeVoidRequestError,
  fetchPendingVoidRequests,
  voidReasonKey,
  type PendingVoidRequest,
} from "@/src/lib/sales/voidRequests";
import { isolateBidi, isolateLtr } from "@/src/lib/text/bidi";
import { Text } from "@/src/theme/Text";
import { colors, radius, spacing, touch } from "@/src/theme/tokens";

function formatWhen(iso: string): string {
  const d = new Date(iso);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${two(d.getDate())}/${two(d.getMonth() + 1)} ${two(d.getHours())}:${two(d.getMinutes())}`;
}

// The owner's list of "please void this sale" requests, from his phone or the
// laptop. Approving voids the sale (stock goes back, reports drop it) so it
// asks first; refusing leaves the sale exactly as it was.
export function VoidRequestsPanel({
  visible,
  onClose,
  onChanged,
}: {
  visible: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const [items, setItems] = useState<PendingVoidRequest[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [refusing, setRefusing] = useState<string | null>(null);
  const [refusalNote, setRefusalNote] = useState("");

  const load = useCallback(async () => {
    setFailed(false);
    setItems(null);
    try {
      setItems(await fetchPendingVoidRequests());
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    if (visible) void load();
  }, [visible, load]);

  const finish = (id: string, text: string) => {
    setItems((current) => (current ?? []).filter((i) => i.id !== id));
    setRefusing(null);
    setRefusalNote("");
    showToast({ text });
    onChanged();
  };

  const approve = async (item: PendingVoidRequest) => {
    const ok = await confirm({
      tone: "danger",
      title: t("shell.voidApproveTitle"),
      summary: [
        formatMAD(item.totalCents),
        formatWhen(item.occurredAt),
        item.cashierName ? isolateBidi(item.cashierName) : null,
      ]
        .filter(Boolean)
        .join(" · "),
      message: t("shell.voidApproveMessage", { amount: isolateLtr(formatMAD(item.totalCents)) }),
      confirmLabel: t("shell.voidApprove"),
      cancelLabel: t("common.cancel"),
    });
    if (!ok) return;
    setBusy(item.id);
    try {
      await decideVoidRequest(item.id, true);
      finish(item.id, t("shell.voidApproved"));
    } catch (error) {
      showToast({ text: describeVoidRequestError(error, t), tone: "info" });
      // The request may have been decided elsewhere; show what is really pending.
      void load();
      onChanged();
    } finally {
      setBusy(null);
    }
  };

  const refuse = async (item: PendingVoidRequest) => {
    setBusy(item.id);
    try {
      await decideVoidRequest(item.id, false, refusalNote);
      finish(item.id, t("shell.voidRefused"));
    } catch (error) {
      showToast({ text: describeVoidRequestError(error, t), tone: "info" });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Panel visible={visible} title={t("shell.voidRequestsTitle")} onClose={onClose}>
      {failed ? (
        <LoadQueryError what={t("shell.alertsTitle")} onRetry={load} />
      ) : items === null ? (
        <ActivityIndicator style={styles.loader} />
      ) : items.length === 0 ? (
        <EmptyState icon="check" title={t("shell.voidRequestsEmpty")} />
      ) : (
        <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
          {items.map((item) => (
            <View key={item.id} style={styles.card}>
              <View style={styles.row}>
                <Text style={styles.when}>
                  {formatWhen(item.occurredAt)}
                  {item.cashierName
                    ? ` · ${t("shell.reviewBy", { name: isolateBidi(item.cashierName) })}`
                    : ""}
                </Text>
                <Money cents={item.totalCents} size="subtitle" />
              </View>
              <Text style={styles.meta}>{t(paymentMethodKey(item.paymentMethod))}</Text>
              {item.lines.map((line, i) => (
                <Text key={i} style={styles.line}>
                  {`${isolateLtr(String(line.quantity))} × ${isolateBidi(line.name)}`}
                </Text>
              ))}
              <Text style={styles.reason}>
                {t("shell.voidReasonLine", { reason: t(voidReasonKey(item.reasonCode)) })}
              </Text>
              {item.note ? <Text style={styles.note}>{isolateBidi(item.note)}</Text> : null}

              {refusing === item.id ? (
                <View style={styles.refuseBox}>
                  <TextInput
                    style={styles.input}
                    value={refusalNote}
                    onChangeText={setRefusalNote}
                    placeholder={t("shell.voidRefusalNote")}
                    accessibilityLabel={t("shell.voidRefusalNote")}
                  />
                  <BigButton
                    label={t("shell.voidRefuseConfirm")}
                    variant="secondary"
                    disabled={busy === item.id}
                    onPress={() => refuse(item)}
                  />
                  <BigButton
                    label={t("common.cancel")}
                    variant="secondary"
                    onPress={() => {
                      setRefusing(null);
                      setRefusalNote("");
                    }}
                  />
                </View>
              ) : (
                <View style={styles.actions}>
                  <BigButton
                    label={t("shell.voidApprove")}
                    variant="danger"
                    disabled={busy === item.id}
                    onPress={() => approve(item)}
                  />
                  <BigButton
                    label={t("shell.voidRefuse")}
                    variant="secondary"
                    disabled={busy === item.id}
                    onPress={() => {
                      setRefusing(item.id);
                      setRefusalNote("");
                    }}
                  />
                </View>
              )}
            </View>
          ))}
        </ScrollView>
      )}
    </Panel>
  );
}

const styles = StyleSheet.create({
  loader: { marginTop: spacing.s6 },
  list: { gap: spacing.s3, paddingBottom: spacing.s5 },
  card: {
    backgroundColor: colors.sunken,
    borderRadius: radius.control,
    padding: spacing.s3,
    gap: spacing.s2,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.s2,
  },
  when: { flex: 1, fontSize: 15, color: colors.ink600 },
  meta: { fontSize: 15, color: colors.ink600 },
  line: { fontSize: 16, color: colors.ink900 },
  reason: { fontSize: 17, fontWeight: "700", color: colors.ink900 },
  note: { fontSize: 16, color: colors.ink700, fontStyle: "italic" },
  actions: { gap: spacing.s2 },
  refuseBox: { gap: spacing.s2 },
  input: {
    minHeight: touch.lg,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.s3,
    fontSize: 16,
  },
});
