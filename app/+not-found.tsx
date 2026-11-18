import { Link, Stack } from "expo-router";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native";

import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";

export default function NotFoundScreen() {
  const { t } = useTranslation();
  return (
    <>
      <Stack.Screen options={{ title: t("screenTitles.notFoundTitle") }} />
      <ThemedView style={styles.container}>
        <ThemedText type="title">{t("screenTitles.notFound")}</ThemedText>
        <Link href="/" style={styles.link}>
          <ThemedText type="link">{t("screenTitles.goHome")}</ThemedText>
        </Link>
      </ThemedView>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  link: {
    marginTop: 15,
    paddingVertical: 15,
  },
});
