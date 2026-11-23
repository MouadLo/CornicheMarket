import { Stack } from "expo-router";
import { useTranslation } from "react-i18next";

import { useKeepAwakeWhileFocused } from "@/src/lib/device/useKeepAwakeWhileFocused";
import { sectionStackOptions } from "@/src/components/nav/SectionBackButton";

export default function SellLayout() {
  const { t } = useTranslation();
  // The whole Sell section (cart, credit, history), not just the cart screen:
  // a cashier moves between them mid-shift and the tablet must not sleep.
  useKeepAwakeWhileFocused("sell");

  return (
    <Stack screenOptions={sectionStackOptions}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="history" options={{ title: t("sell.history") }} />
      <Stack.Screen name="day" options={{ title: t("day.title") }} />
      <Stack.Screen name="print-station" options={{ title: t("printStation.title") }} />
    </Stack>
  );
}
