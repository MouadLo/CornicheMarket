import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { Banner } from "@/src/components/ui/Banner";
import { InlineError } from "@/src/components/ui/InlineError";
import { LoadError } from "@/src/components/ui/LoadError";
import { useAuth } from "@/src/lib/auth/AuthProvider";
import {
  deactivateStaff,
  fetchStaff,
  reactivateStaff,
  resendStaffInvite,
  staffActions,
  type StaffAction,
  type StaffMember,
  type StaffStatus,
} from "@/src/lib/auth/staff";
import { confirm } from "@/src/lib/dialog/store";
import { errorKey, errorKeyOr } from "@/src/lib/errors/userMessage";
import { isolateBidi, isolateLtr } from "@/src/lib/text/bidi";
import { Text } from "@/src/theme/Text";
import { colors, radius, spacing, touch } from "@/src/theme/tokens";

const STATUS_STYLE: Record<StaffStatus, { bg: string; fg: string }> = {
  active: { bg: colors.success100, fg: colors.success700 },
  pending: { bg: colors.warning100, fg: colors.warning700 },
  deactivated: { bg: colors.danger100, fg: colors.danger700 },
};
const STATUS_KEY: Record<StaffStatus, string> = {
  active: "settings.statusActive",
  pending: "settings.statusPending",
  deactivated: "settings.statusDeactivated",
};

// The owner's staff list: who can sign in, who has not accepted yet, who was
// deactivated. Deactivating blocks the account at once and keeps every past
// sale under the person's name. `refreshKey` reloads the list (after an invite).
export function StaffSection({ refreshKey = 0 }: { refreshKey?: number }) {
  const { t, i18n } = useTranslation();
  const { session } = useAuth();
  const selfId = session?.user.id ?? null;
  const [staff, setStaff] = useState<StaffMember[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Translation keys (see errorKey), never the server's text.
  const [actionError, setActionError] = useState<{ id: string; key: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoadError(null);
    fetchStaff()
      .then(setStaff)
      .catch((e) => setLoadError(errorKey(e)));
  }, []);

  useEffect(load, [load, refreshKey]);

  const run = async (member: StaffMember, action: StaffAction) => {
    if (busyId) return;
    setMessage(null);
    setActionError(null);
    if (action === "deactivate" || action === "reactivate") {
      const prefix = action === "deactivate" ? "settings.deactivate" : "settings.reactivate";
      const ok = await confirm({
        tone: action === "deactivate" ? "danger" : undefined,
        title: t(`${prefix}Title`, { name: member.fullName }),
        message: t(`${prefix}Message`, { name: member.fullName }),
        confirmLabel: t(`${prefix}Confirm`),
        cancelLabel: t("common.cancel"),
      });
      if (!ok) return;
    }
    setBusyId(member.id);
    try {
      if (action === "deactivate") await deactivateStaff(member.id);
      else if (action === "reactivate") await reactivateStaff(member.id);
      else await resendStaffInvite(member.id);
      setMessage(
        action === "deactivate"
          ? t("settings.staffDeactivatedDone", { name: member.fullName })
          : action === "reactivate"
            ? t("settings.staffReactivatedDone", { name: member.fullName })
            : t("settings.inviteResent", { email: member.email })
      );
    } catch (e) {
      setActionError({ id: member.id, key: errorKeyOr(e, "errors.generic") });
    } finally {
      setBusyId(null);
      // Show what the server now says, also after a partial failure.
      load();
    }
  };

  if (loadError && !staff) {
    return <LoadError title={t("settings.staffLoadError")} reasonKey={loadError} onRetry={load} />;
  }
  if (!staff) return <Text style={styles.hint}>{t("common.loading")}</Text>;

  return (
    <View style={styles.list}>
      <Text style={styles.hint}>{t("settings.staffHint")}</Text>
      {message ? <Banner tone="ok" text={message} /> : null}
      {loadError ? (
        <Banner
          tone="warn"
          text={t("settings.staffLoadError")}
          action={{ label: t("common.retry"), onPress: load }}
        />
      ) : null}
      {staff.map((member) => {
        const actions = staffActions(member, selfId);
        const status = STATUS_STYLE[member.status];
        return (
          <View key={member.id} style={styles.row} testID={`staff-${member.id}`}>
            <View style={styles.head}>
              <View style={styles.who}>
                <Text style={styles.name}>
                  {isolateBidi(member.fullName)}
                  {member.id === selfId ? ` (${t("settings.staffYou")})` : ""}
                </Text>
                <Text style={styles.meta}>{isolateLtr(member.email)}</Text>
                <Text style={styles.meta}>
                  {member.role === "owner" ? t("shell.roleOwner") : t("shell.roleCashier")}
                  {" · "}
                  {member.lastSignInAt
                    ? t("settings.lastSignIn", {
                        when: new Date(member.lastSignInAt).toLocaleString(i18n.language),
                      })
                    : t("settings.neverSignedIn")}
                </Text>
              </View>
              <View style={[styles.pill, { backgroundColor: status.bg }]}>
                <Text style={[styles.pillText, { color: status.fg }]}>
                  {t(STATUS_KEY[member.status])}
                </Text>
              </View>
            </View>
            {actions.length > 0 ? (
              <View style={styles.actions}>
                {actions.map((action) => (
                  <Pressable
                    key={action}
                    accessibilityRole="button"
                    disabled={busyId !== null}
                    onPress={() => run(member, action)}
                    style={[styles.action, busyId !== null && styles.actionDisabled]}
                  >
                    <Text
                      style={[styles.actionText, action === "deactivate" && styles.actionDanger]}
                    >
                      {t(`settings.${action === "resend_invite" ? "resendInvite" : action}`)}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
            {actionError?.id === member.id ? <InlineError reasonKey={actionError.key} /> : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.s3 },
  hint: { fontSize: 13, color: colors.ink600, lineHeight: 18 },
  row: {
    gap: spacing.s2,
    padding: spacing.s3,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  head: { flexDirection: "row", alignItems: "flex-start", gap: spacing.s3 },
  who: { flex: 1, gap: 2 },
  name: { fontSize: 16, fontWeight: "600", color: colors.ink900 },
  meta: { fontSize: 13, color: colors.ink600 },
  pill: { paddingHorizontal: spacing.s3, paddingVertical: spacing.s1, borderRadius: radius.pill },
  pillText: { fontSize: 12, fontWeight: "700" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.s2 },
  action: {
    minHeight: touch.min,
    paddingHorizontal: spacing.s4,
    justifyContent: "center",
    borderRadius: radius.control,
    borderWidth: 1.5,
    borderColor: colors.ink400,
    backgroundColor: colors.surface,
  },
  actionDisabled: { opacity: 0.5 },
  actionText: { fontSize: 15, fontWeight: "600", color: colors.ink900 },
  actionDanger: { color: colors.danger700 },
});
