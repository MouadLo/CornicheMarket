import { Redirect, router, useLocalSearchParams } from "expo-router";
import { StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { Tabs } from "@/src/components/ui/Tabs";
import { CategoriesTab } from "@/src/components/webstore/CategoriesTab";
import { KitsTab } from "@/src/components/webstore/KitsTab";
import { ProductsTab } from "@/src/components/webstore/ProductsTab";
import { useAuth } from "@/src/lib/auth/AuthProvider";
import { colors } from "@/src/theme/tokens";

type Tab = "products" | "kits" | "categories";
const TABS: readonly Tab[] = ["products", "kits", "categories"];

const isTab = (value: unknown): value is Tab =>
  typeof value === "string" && (TABS as readonly string[]).includes(value);

// Owner only (a cashier is sent back to Vente). Boutique en ligne: the
// products of the site, its kits, and its categories. The open tab lives in the
// URL (`/webstore?tab=kits`), so coming back from a screen opened from a tab
// (or a reload) shows the same tab. Each tab reloads when the screen is focused.
export default function Webstore() {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const isOwner = profile?.role === "owner";
  const params = useLocalSearchParams<{ tab?: string }>();
  const tab: Tab = isTab(params.tab) ? params.tab : "products";

  if (profile && !isOwner) return <Redirect href="/(app)/sell" />;
  if (!isOwner) return null;

  return (
    <View style={styles.screen}>
      <Tabs
        items={TABS.map((key) => ({ key, label: t(`webstore.tabs.${key}`) }))}
        value={tab}
        onChange={(key) => router.setParams({ tab: key })}
      />
      <View style={styles.body} key={tab}>
        {tab === "products" ? <ProductsTab /> : null}
        {tab === "kits" ? <KitsTab /> : null}
        {tab === "categories" ? <CategoriesTab /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1 },
});
