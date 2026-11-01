import type { ReactNode } from "react";
import { Modal, Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import { useTranslation } from "react-i18next";

import { Text } from "@/src/theme/Text";
import { colors, spacing, touch } from "@/src/theme/tokens";
import { Icon } from "./Icon";

export const PANEL_WIDTH = 480;
export const DOCK_BREAKPOINT = 900;

// From 900 dp the panel docks beside its list; below, it takes the whole screen.
export function panelMode(width: number): "docked" | "fullscreen" {
  return width >= DOCK_BREAKPOINT ? "docked" : "fullscreen";
}

type Props = {
  visible: boolean;
  title: string;
  onClose: () => void;
  // Set when the panel drilled into a sub-view (ticket list -> one ticket).
  onBack?: () => void;
  // The primary action goes at the end of the footer, a destructive one at the start.
  footer?: ReactNode;
  children: ReactNode;
  width?: number;
};

export function Panel({
  visible,
  title,
  onClose,
  onBack,
  footer,
  children,
  width = PANEL_WIDTH,
}: Props) {
  const { t } = useTranslation();
  const dims = useWindowDimensions();
  if (!visible) return null;
  const mode = panelMode(dims.width);

  const body = (
    <View style={[styles.panel, mode === "docked" ? { width } : styles.full]}>
      <View style={styles.head}>
        {onBack || mode === "fullscreen" ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("common.back")}
            onPress={onBack ?? onClose}
            style={styles.iconButton}
          >
            <Icon name="back" />
          </Pressable>
        ) : null}
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {mode === "docked" ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("common.close")}
            onPress={onClose}
            style={styles.iconButton}
          >
            <Icon name="x" />
          </Pressable>
        ) : null}
      </View>
      <View style={styles.body}>{children}</View>
      {footer ? <View style={styles.foot}>{footer}</View> : null}
    </View>
  );

  return mode === "docked" ? (
    body
  ) : (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      {body}
    </Modal>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: colors.surface,
    borderStartWidth: 1,
    borderStartColor: colors.border,
  },
  full: { flex: 1, borderStartWidth: 0 },
  head: {
    height: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.s2,
    paddingHorizontal: spacing.s3,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  title: {
    flex: 1,
    fontSize: 20,
    fontWeight: "700",
    color: colors.ink900,
    paddingHorizontal: spacing.s2,
  },
  iconButton: {
    width: touch.min,
    height: touch.min,
    alignItems: "center",
    justifyContent: "center",
  },
  body: { flex: 1, padding: spacing.s4 },
  foot: {
    padding: spacing.s3,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.s3,
  },
});
