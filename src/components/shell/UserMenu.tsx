import { StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { BigButton } from "@/src/components/BigButton";
import { Chip } from "@/src/components/ui/Chip";
import { Popover } from "@/src/components/ui/Popover";
import { Text } from "@/src/theme/Text";
import { colors, spacing } from "@/src/theme/tokens";
import { TOPBAR_HEIGHT } from "./TopBar";

const LANGUAGES = [
  { code: "fr", label: "Français" },
  { code: "ar", label: "العربية" },
  { code: "en", label: "English" },
] as const;

export type LanguageCode = (typeof LANGUAGES)[number]["code"];

// Who is at the till, the device language and sign out. A cashier has no
// Settings section, so the language and sign-out live here for both roles.
export function UserMenu({
  visible,
  onClose,
  name,
  roleLabel,
  language,
  onLanguage,
  onSignOut,
}: {
  visible: boolean;
  onClose: () => void;
  name: string;
  roleLabel: string;
  language: string;
  onLanguage: (code: LanguageCode) => void;
  onSignOut: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Popover visible={visible} onClose={onClose} top={TOPBAR_HEIGHT + 4} width={360}>
      <View style={styles.head}>
        <Text style={styles.name}>{name}</Text>
        <Text style={styles.role}>{roleLabel}</Text>
      </View>
      <View style={styles.section}>
        <Text style={styles.label}>{t("shell.language")}</Text>
        <View style={styles.chips}>
          {LANGUAGES.map((l) => (
            <Chip
              key={l.code}
              label={l.label}
              selected={language === l.code}
              onPress={() => onLanguage(l.code)}
            />
          ))}
        </View>
      </View>
      <View style={styles.section}>
        <BigButton label={t("shell.signOut")} variant="secondary" onPress={onSignOut} />
      </View>
    </Popover>
  );
}

const styles = StyleSheet.create({
  head: { padding: spacing.s4, borderBottomWidth: 1, borderBottomColor: colors.divider },
  name: { fontSize: 20, fontWeight: "700", color: colors.ink900 },
  role: { fontSize: 15, color: colors.ink600 },
  section: {
    padding: spacing.s4,
    gap: spacing.s2,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  label: { fontSize: 15, fontWeight: "600", color: colors.ink700 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.s2 },
});
