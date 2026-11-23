import { Stack } from "expo-router";
import { useTranslation } from "react-i18next";
import { sectionStackOptions } from "@/src/components/nav/SectionBackButton";

export default function ProductsLayout() {
  const { t } = useTranslation();
  return (
    <Stack screenOptions={sectionStackOptions}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="new" options={{ title: t("screenTitles.newProduct") }} />
      <Stack.Screen name="[id]" options={{ title: t("screenTitles.editProduct") }} />
      <Stack.Screen name="import" options={{ title: t("screenTitles.importProducts") }} />
      <Stack.Screen name="categories" options={{ title: t("products.manageCategories") }} />
      <Stack.Screen name="history/[id]" options={{ title: t("screenTitles.priceHistory") }} />
    </Stack>
  );
}
