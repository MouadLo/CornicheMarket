import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { BigButton } from "@/src/components/BigButton";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { LoadError } from "@/src/components/ui/LoadError";
import { CategoryIcon } from "@/src/components/webstore/CategoryIcon";
import { IconButton } from "@/src/components/webstore/IconButton";
import { showToast } from "@/src/lib/dialog/store";
import { errorKey } from "@/src/lib/errors/userMessage";
import { isolateBidi } from "@/src/lib/text/bidi";
import { categoryName, type UsageCounts } from "@/src/lib/webstore/categories";
import { fetchUsageCounts, moveCategory } from "@/src/lib/webstore/categoryQueries";
import { fetchWebCategories } from "@/src/lib/webstore/queries";
import type { WebCategory } from "@/src/lib/webstore/types";
import { Text } from "@/src/theme/Text";
import { colors, touch } from "@/src/theme/tokens";

// The "Catégories" tab: the site's categories in the order of the site, with
// how many sub-categories and products each has. Tap to edit; the arrows
// reorder (and save at once).
export function CategoriesTab() {
  const { t } = useTranslation();
  const [categories, setCategories] = useState<WebCategory[] | null>(null);
  const [usage, setUsage] = useState<UsageCounts>({ byCategory: {}, bySub: {} });
  const [loadError, setLoadError] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [list, counts] = await Promise.all([fetchWebCategories(), fetchUsageCounts()]);
      setCategories(list);
      setUsage(counts);
    } catch (failure) {
      setLoadError(errorKey(failure));
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const move = async (id: string, dir: -1 | 1) => {
    if (!categories || moving) return;
    setMoving(true);
    try {
      await moveCategory(categories, id, dir);
      setCategories(await fetchWebCategories());
    } catch {
      showToast({ text: t("webstore.cats.moveError"), tone: "info" });
    } finally {
      setMoving(false);
    }
  };

  if (loadError && !categories) {
    return (
      <LoadError
        title={t("webstore.cats.loadError")}
        reasonKey={loadError}
        onRetry={() => void load()}
      />
    );
  }
  if (!categories) return <ActivityIndicator style={styles.loading} />;

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <BigButton
          label={t("webstore.cats.add")}
          onPress={() => router.push("/(app)/webstore/category/new")}
        />
      </View>
      {categories.length === 0 ? (
        <EmptyState
          icon="package"
          title={t("webstore.cats.emptyTitle")}
          message={t("webstore.cats.emptyHint")}
        />
      ) : (
        categories.map((category, index) => {
          const name = categoryName(category);
          return (
            <View key={category.id} style={styles.row}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={name}
                onPress={() => router.push(`/(app)/webstore/category/${category.id}`)}
                style={({ pressed }) => [styles.main, pressed && styles.pressed]}
              >
                <CategoryIcon icon={category.icon} />
                <View style={styles.text}>
                  <Text style={styles.title} numberOfLines={1}>
                    {isolateBidi(name)}
                  </Text>
                  {category.name && category.name !== name ? (
                    <Text style={styles.sub} numberOfLines={1}>
                      {isolateBidi(category.name)}
                    </Text>
                  ) : null}
                  <Text style={styles.sub}>
                    {t("webstore.cats.counts", {
                      subs: category.subs.length,
                      products: usage.byCategory[category.id] ?? 0,
                    })}
                  </Text>
                </View>
              </Pressable>
              <IconButton
                icon="arrowUp"
                label={t("webstore.cats.moveUp", { name })}
                disabled={index === 0 || moving}
                onPress={() => void move(category.id, -1)}
              />
              <IconButton
                icon="arrowDown"
                label={t("webstore.cats.moveDown", { name })}
                disabled={index === categories.length - 1 || moving}
                onPress={() => void move(category.id, 1)}
              />
            </View>
          );
        })
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  loading: { marginTop: 40 },
  content: { paddingBottom: 32 },
  header: { padding: 12, gap: 12 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    minHeight: touch.lg,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  main: { flex: 1, flexDirection: "row", alignItems: "center", gap: 12 },
  pressed: { opacity: 0.7 },
  text: { flex: 1, gap: 2 },
  title: { fontSize: 16, fontWeight: "600", color: colors.ink900 },
  sub: { fontSize: 14, color: colors.ink600 },
});
