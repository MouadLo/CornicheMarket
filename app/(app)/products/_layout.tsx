import { Stack } from "expo-router";
import { useTranslation } from "react-i18next";

export default function ProductsLayout() {
  const { t } = useTranslation();
  return (
    <Stack>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="new" options={{ title: t("leftovers.titles.newProduct") }} />
      <Stack.Screen name="[id]" options={{ title: t("leftovers.titles.editProduct") }} />
      <Stack.Screen name="import" options={{ title: t("leftovers.titles.importProducts") }} />
      <Stack.Screen name="categories" options={{ title: t("products.manageCategories") }} />
      <Stack.Screen name="history/[id]" options={{ title: t("leftovers.titles.priceHistory") }} />
    </Stack>
  );
}
