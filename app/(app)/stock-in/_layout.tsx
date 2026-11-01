import { Stack } from "expo-router";
import { useTranslation } from "react-i18next";

export default function StockInLayout() {
  const { t } = useTranslation();

  return (
    <Stack>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="history" options={{ title: "Purchase history" }} />
      <Stack.Screen name="delivery/[id]" options={{ title: t("stockIn.deliveryTitle") }} />
      <Stack.Screen name="low-stock" options={{ title: "Low stock & reorder" }} />
      <Stack.Screen name="adjust" options={{ title: "Stock adjustments" }} />
      <Stack.Screen name="count" options={{ title: "Stock count" }} />
      <Stack.Screen name="expiring" options={{ title: "Expiring soon" }} />
      <Stack.Screen name="negative-stock" options={{ title: "Negative stock" }} />
    </Stack>
  );
}
