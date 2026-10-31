import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { router } from "expo-router";

import { BigButton } from "@/src/components/BigButton";

// Shown on Sell in place of the plain "scan or search" hint when the owner
// has added 0 products -- production starts empty, and that first screen
// otherwise gives no hint of what to do next.
export function EmptyStorePrompt() {
  const { t } = useTranslation();

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{t("sell.emptyStoreTitle")}</Text>
      <Text style={styles.hint}>{t("sell.emptyStoreHint")}</Text>
      <View style={styles.actions}>
        <View style={styles.flex}>
          <BigButton
            label={t("sell.emptyStoreAddProduct")}
            onPress={() => router.push("/(app)/products/new")}
          />
        </View>
        <View style={styles.flex}>
          <BigButton
            label={t("sell.emptyStoreImportCsv")}
            variant="secondary"
            onPress={() => router.push("/(app)/products/import")}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 24,
    padding: 20,
    gap: 10,
    backgroundColor: "#f4f6f5",
    borderRadius: 16,
    alignItems: "center",
  },
  title: { fontSize: 18, fontWeight: "700", textAlign: "center" },
  hint: { fontSize: 14, color: "#666", textAlign: "center" },
  actions: { flexDirection: "row", gap: 10, marginTop: 8, width: "100%", maxWidth: 420 },
  flex: { flex: 1 },
});
