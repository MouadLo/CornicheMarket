import { Stack } from "expo-router";
import { useTranslation } from "react-i18next";
import { sectionStackOptions } from "@/src/components/nav/SectionBackButton";

// The owner-only gate is the route guard in app/(app)/_layout.tsx (the
// "webstore" section is ownerOnly); each screen also checks the role.
export default function WebstoreLayout() {
  const { t } = useTranslation();
  return (
    <Stack screenOptions={sectionStackOptions}>
      <Stack.Screen name="index" options={{ title: t("nav.webstore") }} />
      <Stack.Screen name="new" options={{ title: t("screenTitles.webstoreNew") }} />
      <Stack.Screen name="[id]" options={{ title: t("screenTitles.webstoreProduct") }} />
    </Stack>
  );
}
