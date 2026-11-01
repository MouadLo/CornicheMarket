import { useCallback } from "react";
import { useTranslation } from "react-i18next";

import { useAuth } from "@/src/lib/auth/AuthProvider";
import { confirm } from "@/src/lib/dialog/store";
import { countPendingFor } from "@/src/lib/sales/offlineQueue";

// Signing out with sales still waiting to be sent would strand them: only this
// user's session may send them (audit C05). They are never deleted; they stay
// on the device until this user signs back in or the owner recovers them. So
// ask first, and say so. With nothing pending, sign out straight away.
export function useSignOut() {
  const { t } = useTranslation();
  const { session, profile, signOut } = useAuth();
  const userId = session?.user.id ?? null;
  const name = profile?.full_name ?? "";

  return useCallback(async () => {
    // If the queue can't be read we can't promise there is nothing in it: ask.
    const pending = await countPendingFor(userId).catch(() => null);
    if (pending === null || pending > 0) {
      const ok = await confirm({
        tone: "danger",
        title: t("shell.signOutPendingTitle"),
        message:
          pending === null
            ? t("shell.signOutPendingUnknown")
            : t("shell.signOutPendingMessage", { count: pending, name }),
        confirmLabel: t("shell.signOut"),
        cancelLabel: t("shell.signOutStay"),
      });
      if (!ok) return;
    }
    await signOut();
  }, [userId, name, signOut, t]);
}
