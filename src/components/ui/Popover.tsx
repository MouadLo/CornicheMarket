import type { ReactNode } from "react";
import { Modal, Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import { useTranslation } from "react-i18next";

import { colors, radius } from "@/src/theme/tokens";

// A small menu opened from a button (account, sync status, "More"). It sits at
// the end edge under the top bar; a tap anywhere else closes it. Nothing with
// a Save button belongs here: use a dialog or a panel.
export function Popover({
  visible,
  onClose,
  children,
  top = 64,
  width = 360,
}: {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
  top?: number;
  width?: number;
}) {
  // Never wider than the screen minus its 12 px margins (a 380 menu on a 375 phone).
  const { t } = useTranslation();
  const screen = useWindowDimensions().width;
  const fit = Math.min(width, Math.max(0, screen - 24));
  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <Pressable
        accessibilityRole="button"
        style={StyleSheet.absoluteFill}
        onPress={onClose}
        accessibilityLabel={t("common.close")}
      />
      <View style={[styles.card, { top, width: fit }]} accessibilityViewIsModal>
        {children}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  card: {
    position: "absolute",
    end: 12,
    backgroundColor: colors.surface,
    borderRadius: radius.panel,
    overflow: "hidden",
    shadowColor: colors.ink900,
    shadowOpacity: 0.28,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 12 },
    elevation: 8,
  },
});
