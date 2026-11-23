import { Stack } from "expo-router";
import { useTranslation } from "react-i18next";
import { sectionStackOptions } from "@/src/components/nav/SectionBackButton";

// The credit ledger (the "carnet"): balances and repayments. It used to be a
// small link on Sell; it is a section of its own now. A customer's history
// opens on top of the list.
export default function ClientsLayout() {
  const { t } = useTranslation();
  return (
    <Stack screenOptions={sectionStackOptions}>
      <Stack.Screen name="index" options={{ title: t("nav.clients") }} />
      <Stack.Screen name="[id]" options={{ title: t("credit.historyTitle") }} />
    </Stack>
  );
}
