import { Stack } from "expo-router";
import { useTranslation } from "react-i18next";

export default function StockInLayout() {
  const { t } = useTranslation();

  return (
    <Stack>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="history" options={{ title: t("leftovers.titles.purchaseHistory") }} />
      <Stack.Screen name="delivery/[id]" options={{ title: t("stockIn.deliveryTitle") }} />
      <Stack.Screen name="invoice/index" options={{ title: t("invoices.drafts") }} />
      <Stack.Screen name="invoice/capture" options={{ title: t("invoices.scan") }} />
      <Stack.Screen name="invoice/[id]" options={{ title: t("invoices.reviewTitle") }} />
      <Stack.Screen name="low-stock" options={{ title: t("leftovers.titles.lowStock") }} />
      <Stack.Screen name="adjust" options={{ title: t("leftovers.titles.adjustments") }} />
      <Stack.Screen name="count" options={{ title: t("leftovers.titles.count") }} />
      <Stack.Screen name="expiring" options={{ title: t("leftovers.titles.expiring") }} />
      <Stack.Screen
        name="negative-stock"
        options={{ title: t("leftovers.titles.negativeStock") }}
      />
    </Stack>
  );
}
