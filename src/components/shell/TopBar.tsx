import { Pressable, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { Badge } from "@/src/components/ui/Badge";
import { Icon } from "@/src/components/ui/Icon";
import { softTones, type Tone } from "@/src/theme/tones";
import { Text } from "@/src/theme/Text";
import { colors } from "@/src/theme/tokens";
import { BrandMark } from "./BrandMark";
import { Clock } from "./Clock";

export const TOPBAR_HEIGHT = 56;

export type SyncPillState = {
  tone: Tone;
  label: string;
  icon: "check" | "wifiOff" | "alert" | "refresh";
};

type Props = {
  compact: boolean;
  scannerReady: boolean;
  sync: SyncPillState;
  // null for a cashier: no alert button at all.
  alertCount: number | null;
  userName: string;
  userInitial: string;
  roleLabel: string;
  onSync: () => void;
  onAlerts: () => void;
  onUser: () => void;
};

export function TopBar({
  compact,
  scannerReady,
  sync,
  alertCount,
  userName,
  userInitial,
  roleLabel,
  onSync,
  onAlerts,
  onUser,
}: Props) {
  const { t } = useTranslation();
  const pill = softTones[sync.tone];
  return (
    <View style={[styles.bar, compact && styles.barCompact]}>
      <View style={styles.brand}>
        <BrandMark size={compact ? 32 : 36} />
        <Text style={[styles.name, compact && styles.nameCompact]} numberOfLines={1}>
          {t("shell.storeName")}
        </Text>
      </View>

      <View style={styles.spacer} />

      {scannerReady ? (
        <View style={styles.scanner} accessibilityLabel={t("shell.scannerReady")}>
          <Icon name="scan" size={18} color="#d6e8ee" />
          <Text style={styles.scannerText}>{t("shell.scannerReady")}</Text>
        </View>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={sync.label}
        onPress={onSync}
        style={[styles.pill, { backgroundColor: pill.bg }]}
      >
        <Icon name={sync.icon} size={18} color={pill.fg} />
        {compact ? null : (
          <Text style={[styles.pillText, { color: pill.fg }]} numberOfLines={1}>
            {sync.label}
          </Text>
        )}
      </Pressable>

      {alertCount !== null ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("shell.alertsLabel", { count: alertCount })}
          onPress={onAlerts}
          style={[styles.iconButton, compact && styles.iconButtonCompact]}
        >
          <Icon name="bell" size={22} color="#ffffff" />
          {alertCount > 0 ? (
            <View style={styles.bellBadge}>
              <Badge value={alertCount > 99 ? "99+" : alertCount} tone="bad" />
            </View>
          ) : null}
        </Pressable>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${userName}, ${roleLabel}`}
        onPress={onUser}
        style={styles.user}
      >
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{userInitial}</Text>
        </View>
        {compact ? null : (
          <View>
            <Text style={styles.userName} numberOfLines={1}>
              {userName}
            </Text>
            <Text style={styles.userRole} numberOfLines={1}>
              {roleLabel}
            </Text>
          </View>
        )}
        {compact ? null : <Icon name="down" size={16} color="#ffffff" />}
      </Pressable>

      <Clock showDate={!compact} />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    height: TOPBAR_HEIGHT,
    backgroundColor: colors.brand800,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingStart: 14,
    paddingEnd: 10,
  },
  barCompact: { gap: 4, paddingStart: 10, paddingEnd: 6 },
  brand: { flexDirection: "row", alignItems: "center", gap: 10, flexShrink: 1 },
  // The brand name is Latin text: always left to right, so it never truncates at its head in Arabic.
  name: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.white,
    flexShrink: 1,
    writingDirection: "ltr",
  },
  nameCompact: { fontSize: 15 },
  spacer: { flex: 1 },
  scanner: {
    height: 36,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  scannerText: { fontSize: 15, fontWeight: "600", color: "#d6e8ee" },
  pill: {
    minHeight: 36,
    minWidth: 36,
    paddingHorizontal: 10,
    borderRadius: 999,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  pillText: { fontSize: 15, fontWeight: "600", maxWidth: 200 },
  iconButtonCompact: { width: 38, height: 38 },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  bellBadge: { position: "absolute", top: 0, end: 0 },
  user: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 6,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.sand500,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontSize: 16, fontWeight: "700", color: colors.ink900 },
  userName: { fontSize: 15, fontWeight: "600", color: colors.white, maxWidth: 120 },
  userRole: { fontSize: 12, color: "#b9d3db" },
});
