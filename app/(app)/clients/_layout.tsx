import { Stack } from "expo-router";
import { useTranslation } from "react-i18next";

// The credit ledger (the "carnet"): balances and repayments. It used to be a
// small link on Sell; it is a section of its own now.
export default function ClientsLayout() {
  const { t } = useTranslation();
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: t("nav.clients") }} />
    </Stack>
  );
}
