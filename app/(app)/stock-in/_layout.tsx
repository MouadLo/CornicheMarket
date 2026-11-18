import { Stack } from "expo-router";
import { useTranslation } from "react-i18next";

export default function StockInLayout() {
  const { t } = useTranslation();

  return (
    <Stack>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="receive" options={{ title: t("stockIn.receiveTitle") }} />
      <Stack.Screen name="history" options={{ title: t("screenTitles.purchaseHistory") }} />
      <Stack.Screen name="delivery/[id]" options={{ title: t("stockIn.deliveryTitle") }} />
      <Stack.Screen name="invoice/index" options={{ title: t("invoices.drafts") }} />
      <Stack.Screen name="invoice/capture" options={{ title: t("invoices.scan") }} />
      <Stack.Screen name="invoice/[id]" options={{ title: t("invoices.reviewTitle") }} />
      <Stack.Screen name="low-stock" options={{ title: t("screenTitles.lowStock") }} />
      <Stack.Screen name="adjust" options={{ title: t("screenTitles.adjustments") }} />
      <Stack.Screen name="count" options={{ title: t("screenTitles.count") }} />
      <Stack.Screen name="expiring" options={{ title: t("screenTitles.expiring") }} />
      <Stack.Screen name="negative-stock" options={{ title: t("screenTitles.negativeStock") }} />
    </Stack>
  );
}
