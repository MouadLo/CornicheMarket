import { StyleSheet, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";

import { Chip } from "@/src/components/ui/Chip";
import { VOID_REASONS, voidReasonKey, type VoidReason } from "@/src/lib/sales/voidRequests";
import { colors, radius, spacing, touch } from "@/src/theme/tokens";

// The preset reasons for voiding a sale, shared by the cashier's request sheet
// and the owner's own void. Nothing is preselected. "Other" always needs a
// note; with `noteAlways` the other reasons offer an optional one.
export function VoidReasonPicker({
  reason,
  note,
  onReason,
  onNote,
  noteAlways = false,
}: {
  reason: VoidReason | null;
  note: string;
  onReason: (next: VoidReason) => void;
  onNote: (next: string) => void;
  noteAlways?: boolean;
}) {
  const { t } = useTranslation();
  const showNote = reason === "other" || (noteAlways && reason !== null);
  const placeholder = reason === "other" ? t("sell.voidRequestNote") : t("sell.voidNoteOptional");
  return (
    <View style={styles.wrap}>
      <View style={styles.chips}>
        {VOID_REASONS.map((code) => (
          <Chip
            key={code}
            label={t(voidReasonKey(code))}
            selected={reason === code}
            onPress={() => onReason(code)}
          />
        ))}
      </View>
      {showNote ? (
        <TextInput
          style={styles.input}
          value={note}
          onChangeText={onNote}
          placeholder={placeholder}
          accessibilityLabel={placeholder}
          autoFocus={reason === "other"}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.s3 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.s2 },
  input: {
    minHeight: touch.lg,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.s3,
    fontSize: 16,
  },
});
