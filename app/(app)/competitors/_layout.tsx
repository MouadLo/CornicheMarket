import { Stack } from "expo-router";
import { useTranslation } from "react-i18next";
import { sectionStackOptions } from "@/src/components/nav/SectionBackButton";

// The owner-only gate is the route guard in app/(app)/_layout.tsx (the
// "competitors" section is ownerOnly); each screen also checks the role.
export default function CompetitorsLayout() {
  const { t } = useTranslation();
  return (
    <Stack screenOptions={sectionStackOptions}>
      <Stack.Screen name="index" options={{ title: t("nav.competitors") }} />
      <Stack.Screen name="[productId]" options={{ title: t("screenTitles.competitorProduct") }} />
    </Stack>
  );
}
