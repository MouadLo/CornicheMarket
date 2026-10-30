import { Stack } from "expo-router";
import { useTranslation } from "react-i18next";

export default function SellLayout() {
  const { t } = useTranslation();

  return (
    <Stack>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="credit" options={{ title: t("sell.credit") }} />
      <Stack.Screen name="history" options={{ title: t("sell.history") }} />
      <Stack.Screen name="stuck" options={{ title: t("sell.stuck.title") }} />
    </Stack>
  );
}
