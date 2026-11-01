import { useEffect, useSyncExternalStore } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import {
  dismissToast,
  getState,
  registerHost,
  resolveConfirm,
  subscribe,
  type ConfirmRequest,
  type ToastState,
} from "@/src/lib/dialog/store";
import { isolateLtr } from "@/src/lib/text/bidi";
import { Text } from "@/src/theme/Text";
import { colors, radius, spacing } from "@/src/theme/tokens";
import { BigButton } from "../BigButton";
import { Icon } from "./Icon";

// Mount once, in the root layout. Renders the current confirm() request and
// the current toast. Every other screen just calls confirm() / showToast().
export function DialogHost() {
  const state = useSyncExternalStore(subscribe, getState, getState);
  useEffect(() => registerHost(), []);
  return (
    <>
      {state.confirm ? <ConfirmDialog request={state.confirm} /> : null}
      {state.toast ? <ToastView toast={state.toast} /> : null}
    </>
  );
}

export function ConfirmDialog({ request }: { request: ConfirmRequest }) {
  const { t } = useTranslation();
  const danger = request.tone === "danger";
  const answer = (value: boolean) => resolveConfirm(request.id, value);
  return (
    <Modal
      transparent
      visible
      animationType="fade"
      // Android back and the web Escape key count as "no": the promise always resolves.
      onRequestClose={() => answer(false)}
      accessibilityViewIsModal
    >
      {/* A destructive dialog is only closed by one of its two buttons. */}
      <Pressable
        testID="dialog-scrim"
        style={styles.scrim}
        onPress={danger ? undefined : () => answer(false)}
      >
        <Pressable style={styles.dialog} accessibilityRole="alert" onPress={() => {}}>
          <ScrollView bounces={false}>
            <View style={styles.titleRow}>
              <View style={[styles.round, danger ? styles.roundBad : styles.roundInfo]}>
                <Icon
                  name={danger ? "alert" : "info"}
                  size={24}
                  color={danger ? colors.danger700 : colors.brand700}
                />
              </View>
              <Text style={styles.title}>{request.title}</Text>
            </View>
            {request.summary ? <Text style={styles.summary}>{request.summary}</Text> : null}
            {request.message ? <Text style={styles.message}>{request.message}</Text> : null}
            {request.consequences?.length ? (
              <View style={styles.consequences}>
                {request.consequences.map((c, i) => (
                  <View key={`${c.label}-${i}`} style={styles.consequence}>
                    <Text style={styles.cLabel}>{c.label}</Text>
                    {c.before ? <Text style={styles.cBefore}>{isolateLtr(c.before)}</Text> : null}
                    {c.before && c.after ? (
                      <Icon name="chevron" size={18} color={colors.ink600} />
                    ) : null}
                    {c.after ? <Text style={styles.cAfter}>{isolateLtr(c.after)}</Text> : null}
                  </View>
                ))}
              </View>
            ) : null}
          </ScrollView>
          {/* Row direction follows the layout: cancel on the start side, confirm at the end. */}
          <View style={styles.actions}>
            <View style={styles.action}>
              <BigButton
                label={request.cancelLabel ?? t("common.cancel")}
                variant="secondary"
                onPress={() => answer(false)}
              />
            </View>
            <View style={styles.action}>
              <BigButton
                label={request.confirmLabel ?? t("common.confirm")}
                variant={danger ? "danger" : "primary"}
                onPress={() => answer(true)}
              />
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export function ToastView({ toast }: { toast: ToastState }) {
  return (
    <View style={styles.toastZone} pointerEvents="box-none">
      <View style={styles.toast} accessibilityRole="alert" accessibilityLiveRegion="polite">
        <Icon name={toast.tone === "info" ? "info" : "check"} size={22} color="#8ee0ae" />
        <Text style={styles.toastText}>{toast.text}</Text>
        {toast.action ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              toast.action?.onPress();
              dismissToast(toast.id);
            }}
            style={styles.toastAction}
          >
            <Text style={styles.toastActionText}>{toast.action.label}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: "rgba(7, 47, 60, 0.48)",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.s5,
  },
  dialog: {
    width: "100%",
    maxWidth: 480,
    maxHeight: "100%",
    backgroundColor: colors.surface,
    borderRadius: radius.panel,
    padding: spacing.s5,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.s3,
    marginBottom: spacing.s2,
  },
  round: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  roundBad: { backgroundColor: colors.danger100 },
  roundInfo: { backgroundColor: colors.brand100 },
  title: { flex: 1, fontSize: 20, fontWeight: "700", color: colors.ink900 },
  summary: { fontSize: 15, color: colors.ink600, marginBottom: spacing.s2 },
  message: { fontSize: 17, color: colors.ink700 },
  consequences: {
    marginTop: spacing.s4,
    backgroundColor: colors.sunken,
    borderRadius: radius.control,
    paddingHorizontal: spacing.s3,
  },
  consequence: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.s2,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  cLabel: { flex: 1, fontSize: 15, color: colors.ink700 },
  cBefore: { fontSize: 15, color: colors.ink600 },
  cAfter: { fontSize: 15, fontWeight: "700", color: colors.ink900 },
  actions: { flexDirection: "row", gap: spacing.s3, marginTop: spacing.s5 },
  action: { flex: 1 },
  toastZone: {
    position: "absolute",
    top: 72,
    start: 0,
    end: 0,
    alignItems: "center",
    zIndex: 100,
  },
  toast: {
    minHeight: 56,
    maxWidth: 560,
    backgroundColor: colors.ink900,
    borderRadius: radius.control,
    paddingVertical: 6,
    paddingStart: spacing.s4,
    paddingEnd: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.s3,
  },
  toastText: { flexShrink: 1, fontSize: 17, color: colors.white },
  toastAction: { minHeight: 48, paddingHorizontal: spacing.s3, justifyContent: "center" },
  toastActionText: { fontSize: 17, fontWeight: "600", color: "#a9dcea" },
});
