import { usePathname, router } from "expo-router";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Platform, Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import { useTranslation } from "react-i18next";

import { Icon } from "@/src/components/ui/Icon";
import { OfflineBanner } from "@/src/components/ui/OfflineState";
import { Popover } from "@/src/components/ui/Popover";
import { useOwnerAlerts } from "@/src/lib/alerts/useOwnerAlerts";
import { totalAlerts, type ReviewKind } from "@/src/lib/alerts/queries";
import { useAuth } from "@/src/lib/auth/AuthProvider";
import { showToast } from "@/src/lib/dialog/store";
import { changeLanguage, type SupportedLang } from "@/src/i18n";
import {
  SECTIONS,
  allowedSections,
  phoneTabs,
  sectionForPath,
  type Role,
} from "@/src/lib/nav/sections";
import { getProductCacheMeta } from "@/src/lib/products/offlineCache";
import { useSaleSync } from "@/src/lib/sales/useSaleSync";
import { Text } from "@/src/theme/Text";
import { colors, spacing } from "@/src/theme/tokens";
import { AlertsMenu } from "./AlertsMenu";
import { Awning } from "./Awning";
import { BottomTabs } from "./BottomTabs";
import { formatClock } from "./Clock";
import { Rail } from "./Rail";
import { ReviewPanel } from "./ReviewPanel";
import { SyncMenu } from "./SyncMenu";
import { syncPill } from "./syncState";
import { TOPBAR_HEIGHT, TopBar } from "./TopBar";
import { UserMenu, type LanguageCode } from "./UserMenu";

export const DOCK_BREAKPOINT = 900;
const COUNTS_POLL_MS = 5_000;

type Menu = null | "sync" | "alerts" | "user" | "more";

// The POS shell: top bar, awning, navigation (icon rail from 900 dp, bottom
// tabs below), the offline banner, and the owner's review panel. Screens render
// inside it unchanged (docs/THEME-STRUCTURE.md 1.3).
export function AppShell({ children }: { children: ReactNode }) {
  const { t, i18n } = useTranslation();
  const { profile, signOut } = useAuth();
  const { width } = useWindowDimensions();
  const pathname = usePathname();

  const role: Role | null = profile?.role === "owner" ? "owner" : profile ? "cashier" : null;
  const isOwner = role === "owner";
  const compact = width < DOCK_BREAKPOINT;
  const active = sectionForPath(pathname);

  // The sale-sync hook is also used by Sell. The queue and the network run are
  // shared (syncPendingSales joins an active run), so a second instance does not
  // double-send; this one only needs fresh counts, hence the light poll.
  const sync = useSaleSync();
  const refreshPending = sync.refreshPending;
  useEffect(() => {
    const id = setInterval(() => void refreshPending(), COUNTS_POLL_MS);
    return () => clearInterval(id);
  }, [refreshPending]);

  const { counts, refresh: refreshAlerts } = useOwnerAlerts(isOwner, sync.online);
  const [menu, setMenu] = useState<Menu>(null);
  const [review, setReview] = useState<ReviewKind | null>(null);

  // The age of the prices a cashier is selling at while offline.
  const [priceTime, setPriceTime] = useState<string | undefined>();
  useEffect(() => {
    if (sync.online) return;
    void getProductCacheMeta().then((meta) =>
      setPriceTime(meta ? formatClock(new Date(meta.refreshedAt)) : undefined)
    );
  }, [sync.online]);

  const openMenu = useCallback(
    (next: Menu) => {
      setMenu(next);
      if (next === "sync") void refreshPending();
      if (next === "alerts") void refreshAlerts();
    },
    [refreshPending, refreshAlerts]
  );
  const close = () => setMenu(null);

  const syncNow = useCallback(async () => {
    await sync.sync();
  }, [sync]);

  const onLanguage = async (code: LanguageCode) => {
    const needsRestart = await changeLanguage(code as SupportedLang);
    if (needsRestart) showToast({ text: t("shell.restartRequired"), tone: "info" });
    close();
  };

  const name =
    profile?.full_name?.trim() || (isOwner ? t("shell.roleOwner") : t("shell.roleCashier"));
  const roleLabel = isOwner ? t("shell.roleOwner") : t("shell.roleCashier");
  const sections = allowedSections(role);
  const tabs = phoneTabs(role);
  const alertTotal = totalAlerts(counts, sync.stuck);

  return (
    <View style={styles.root}>
      <TopBar
        compact={compact}
        scannerReady={Platform.OS === "web" && !compact && active === "sell"}
        sync={syncPill(sync, isOwner, t)}
        alertCount={isOwner ? alertTotal : null}
        userName={name}
        userInitial={(name[0] ?? "?").toUpperCase()}
        roleLabel={roleLabel}
        onSync={() => openMenu("sync")}
        onAlerts={() => openMenu("alerts")}
        onUser={() => openMenu("user")}
      />
      <Awning />
      {sync.online ? null : (
        <View style={styles.banner}>
          <OfflineBanner priceTime={priceTime} />
        </View>
      )}

      <View style={styles.body}>
        {compact ? null : <Rail sections={sections} active={active} />}
        <View style={styles.content}>{children}</View>
        <ReviewPanel kind={review} onClose={() => setReview(null)} onChanged={refreshAlerts} />
      </View>

      {compact ? (
        <BottomTabs
          tabs={tabs.tabs}
          hasMore={tabs.more.length > 0}
          active={active}
          moreActive={tabs.more.some((id) => id === active)}
          onMore={() => openMenu("more")}
        />
      ) : null}

      <SyncMenu
        visible={menu === "sync"}
        onClose={close}
        state={sync}
        isOwner={isOwner}
        onSyncNow={syncNow}
        onChanged={() => void refreshPending()}
      />
      <AlertsMenu
        visible={menu === "alerts"}
        onClose={close}
        counts={counts}
        stuck={sync.stuck}
        onReview={(kind) => {
          close();
          setReview(kind);
        }}
        onStuck={() => openMenu("sync")}
      />
      <UserMenu
        visible={menu === "user"}
        onClose={close}
        name={name}
        roleLabel={roleLabel}
        language={i18n?.language ?? "fr"}
        onLanguage={onLanguage}
        onSignOut={() => {
          close();
          void signOut();
        }}
      />
      <Popover visible={menu === "more"} onClose={close} top={TOPBAR_HEIGHT + 4} width={280}>
        {SECTIONS.filter((s) => tabs.more.includes(s.id)).map((s) => (
          <Pressable
            key={s.id}
            accessibilityRole="button"
            onPress={() => {
              close();
              router.navigate(s.route as never);
            }}
            style={styles.moreRow}
          >
            <Icon name={s.icon} color={colors.ink700} />
            <Text style={styles.moreLabel}>{t(s.labelKey)}</Text>
          </Pressable>
        ))}
      </Popover>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  banner: { paddingHorizontal: spacing.s3, paddingBottom: spacing.s2 },
  body: { flex: 1, flexDirection: "row", minHeight: 0 },
  content: { flex: 1, minWidth: 0, backgroundColor: colors.surface },
  moreRow: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.s3,
    paddingHorizontal: spacing.s4,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  moreLabel: { fontSize: 17, fontWeight: "600", color: colors.ink900 },
});
