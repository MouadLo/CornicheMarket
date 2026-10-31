import { Stack } from "expo-router";
import { useTranslation } from "react-i18next";

import { useKeepAwakeWhileFocused } from "@/src/lib/device/useKeepAwakeWhileFocused";

export default function SellLayout() {
  const { t } = useTranslation();
  // The whole Sell section (cart, credit, history), not just the cart screen:
  // a cashier moves between them mid-shift and the tablet must not sleep.
  useKeepAwakeWhileFocused("sell");

  return (
    <Stack>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="credit" options={{ title: t("sell.credit") }} />
      <Stack.Screen name="history" options={{ title: t("sell.history") }} />
      <Stack.Screen name="stuck" options={{ title: t("sell.stuck.title") }} />
    </Stack>
  );
}
