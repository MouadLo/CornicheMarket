import { useTranslation } from "react-i18next";
import { StyleSheet, View } from "react-native";

import { BigButton } from "@/src/components/BigButton";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { colors } from "@/src/theme/tokens";

// Shown instead of the whole app when the owner has deactivated this account.
// One sentence and one way out: no retry (it cannot succeed), no raw error text.
export function DeactivatedScreen({ onSignOut }: { onSignOut: () => void }) {
  const { t } = useTranslation();
  return (
    <View style={styles.container}>
      <EmptyState
        icon="lock"
        tone="bad"
        title={t("startup.deactivatedTitle")}
        message={t("startup.deactivatedMessage")}
        action={<BigButton label={t("startup.signOut")} onPress={onSignOut} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", backgroundColor: colors.bg },
});
