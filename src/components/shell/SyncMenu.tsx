import { ScrollView, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { BigButton } from "@/src/components/BigButton";
import { Icon } from "@/src/components/ui/Icon";
import { Popover } from "@/src/components/ui/Popover";
import type { SaleSyncState } from "@/src/components/shell/syncState";
import { Text } from "@/src/theme/Text";
import { colors, spacing } from "@/src/theme/tokens";
import { OthersSalesList } from "./OthersSalesList";
import { StuckSalesList } from "./StuckSalesList";
import { TOPBAR_HEIGHT } from "./TopBar";

// The status behind the top bar's sync pill, and the home of the stuck sales
// (they used to need a banner on Sell and their own screen).
export function SyncMenu({
  visible,
  onClose,
  state,
  isOwner,
  userId,
  onSyncNow,
  onChanged,
}: {
  visible: boolean;
  onClose: () => void;
  state: SaleSyncState;
  isOwner: boolean;
  userId: string | null;
  onSyncNow: () => Promise<void>;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const clean = state.online && state.pending === 0 && state.stuck === 0 && state.others === 0;
  return (
    <Popover visible={visible} onClose={onClose} top={TOPBAR_HEIGHT + 4} width={400}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.body}>
        <View style={styles.head}>
          <Icon
            name={clean ? "check" : state.online ? "refresh" : "wifiOff"}
            color={clean ? colors.success700 : colors.warning700}
          />
          <Text style={styles.title}>
            {!state.online
              ? t("shell.syncOffline")
              : state.pending > 0
                ? t("sell.syncPending", { count: state.pending })
                : clean
                  ? t("shell.syncAllDone")
                  : t("shell.syncUpToDate")}
          </Text>
        </View>
        {!state.online || state.pending > 0 ? (
          <Text style={styles.hint}>{t("shell.syncPendingHint")}</Text>
        ) : null}
        {state.lastError ? (
          <Text style={styles.error}>{t("shell.syncLastError", { error: state.lastError })}</Text>
        ) : null}

        <BigButton
          label={t("shell.syncNow")}
          variant="secondary"
          disabled={state.syncing || !state.online}
          onPress={onSyncNow}
        />

        {state.others > 0 ? (
          isOwner ? (
            <OthersSalesList userId={userId} onChanged={onChanged} />
          ) : (
            <Text style={styles.hint}>
              {t("shell.othersCashierNotice", { count: state.others })}
            </Text>
          )
        ) : null}

        {state.stuck > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t("shell.stuckTitle")}</Text>
            {isOwner ? (
              <StuckSalesList userId={userId} onRetry={onSyncNow} onChanged={onChanged} />
            ) : (
              <Text style={styles.hint}>
                {t("shell.stuckCashierNotice", { count: state.stuck })}
              </Text>
            )}
          </View>
        ) : null}
      </ScrollView>
    </Popover>
  );
}

const styles = StyleSheet.create({
  scroll: { maxHeight: 560 },
  body: { padding: spacing.s4, gap: spacing.s3 },
  head: { flexDirection: "row", alignItems: "center", gap: spacing.s3 },
  title: { flex: 1, fontSize: 17, fontWeight: "700", color: colors.ink900 },
  hint: { fontSize: 15, color: colors.ink600 },
  error: { fontSize: 14, color: colors.danger700 },
  section: { gap: spacing.s2, marginTop: spacing.s2 },
  sectionTitle: { fontSize: 15, fontWeight: "700", color: colors.ink700 },
});
