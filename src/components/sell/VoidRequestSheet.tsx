import { useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";

import { BigButton } from "@/src/components/BigButton";
import { Chip } from "@/src/components/ui/Chip";
import {
  VOID_REASONS,
  voidReasonKey,
  voidRequestValid,
  type VoidReason,
} from "@/src/lib/sales/voidRequests";
import { Text } from "@/src/theme/Text";
import { colors, radius, spacing, touch } from "@/src/theme/tokens";

// The cashier says why a sale should be voided; the owner decides. Nothing is
// voided by sending this: the sale keeps counting until he approves.
export function VoidRequestSheet({
  visible,
  amountLabel,
  saving,
  error,
  onSubmit,
  onClose,
}: {
  visible: boolean;
  amountLabel: string;
  saving: boolean;
  error: string | null;
  onSubmit: (reason: VoidReason, note: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState<VoidReason | null>(null);
  const [note, setNote] = useState("");
  const valid = voidRequestValid(reason, note);

  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel={t("common.cancel")} />
      <View style={styles.sheet} accessibilityViewIsModal>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>{t("sell.voidRequestTitle")}</Text>
          <Text style={styles.hint}>{t("sell.voidRequestHint", { amount: amountLabel })}</Text>
          <View style={styles.chips}>
            {VOID_REASONS.map((code) => (
              <Chip
                key={code}
                label={t(voidReasonKey(code))}
                selected={reason === code}
                onPress={() => setReason(code)}
              />
            ))}
          </View>
          {reason === "other" ? (
            <TextInput
              style={styles.input}
              value={note}
              onChangeText={setNote}
              placeholder={t("sell.voidRequestNote")}
              accessibilityLabel={t("sell.voidRequestNote")}
              autoFocus
            />
          ) : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <BigButton
            label={saving ? t("sell.voidRequestSending") : t("sell.voidRequestSend")}
            disabled={!valid || saving}
            onPress={() => reason && onSubmit(reason, note)}
          />
          <BigButton label={t("common.cancel")} variant="secondary" onPress={onClose} />
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: {
    maxHeight: "85%",
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.panel,
    borderTopRightRadius: radius.panel,
  },
  content: { padding: spacing.s4, gap: spacing.s3 },
  title: { fontSize: 20, fontWeight: "700", color: colors.ink900 },
  hint: { fontSize: 15, color: colors.ink600 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.s2 },
  input: {
    minHeight: touch.lg,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.s3,
    fontSize: 16,
  },
  error: { color: colors.danger700, fontSize: 15 },
});
