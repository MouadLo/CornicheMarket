import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";

import { BigButton } from "@/src/components/BigButton";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { InlineError } from "@/src/components/ui/InlineError";
import { LoadError } from "@/src/components/ui/LoadError";
import { errorKey, errorKeyOr } from "@/src/lib/errors/userMessage";
import { BulkPriceModal } from "@/src/components/products/BulkPriceModal";
import { PRODUCT_ROW_HEIGHT, ProductRow } from "@/src/components/products/ProductRow";
import { useAuth } from "@/src/lib/auth/AuthProvider";
import { saveTextFile } from "@/src/lib/files";
import { toCsv } from "@/src/lib/products/csv";
import {
  fetchAllProducts,
  fetchCategories,
  fetchProducts,
  PAGE_SIZE,
  type Category,
  type Product,
  type ProductFilters,
  type ProductStatusFilter,
} from "@/src/lib/products/queries";
import { categoryLabel } from "@/src/lib/products/categoryCatalog";
import { familyIds, mainCategories, subCategoriesOf } from "@/src/lib/products/categories";
import { useDebouncedValue } from "@/src/lib/useDebouncedValue";

export default function ProductsScreen() {
  const { profile } = useAuth();
  const { t, i18n } = useTranslation();
  const isOwner = profile?.role === "owner";

  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [subCategoryId, setSubCategoryId] = useState<string | null>(null);
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [status, setStatus] = useState<ProductStatusFilter>("active");

  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  // Translation keys (see errorKey): a failed read replaces the list, so it can
  // never look like an empty catalog; a failed export sits by its buttons.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [busyMessage, setBusyMessage] = useState<string | null>(null);

  const debouncedSearch = useDebouncedValue(search, 300);
  // "No match" and "nothing here yet" need different words and different next steps.
  const filtered =
    debouncedSearch.trim() !== "" || categoryId !== null || lowStockOnly || status !== "active";

  const filters = useMemo<ProductFilters>(
    () => ({
      search: debouncedSearch,
      categoryId,
      categoryIds: subCategoryId
        ? [subCategoryId]
        : categoryId
          ? familyIds(categories, categoryId)
          : undefined,
      lowStockOnly,
      status,
    }),
    [debouncedSearch, categoryId, subCategoryId, categories, lowStockOnly, status]
  );

  // Re-read on every return to this screen: a category may have been created
  // in the product form since.
  useFocusEffect(
    useCallback(() => {
      fetchCategories()
        .then(setCategories)
        .catch(() => setCategories([]));
    }, [])
  );

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const rows = await fetchProducts(filters, 0, isOwner);
      setProducts(rows);
      setPage(0);
      setHasMore(rows.length === PAGE_SIZE);
    } catch (failure) {
      setLoadError(errorKey(failure));
    } finally {
      setLoading(false);
    }
  }, [filters, isOwner]);

  useEffect(() => {
    load();
  }, [load]);

  const loadMore = useCallback(async () => {
    if (loadingMore || loading || !hasMore) return;

    setLoadingMore(true);
    try {
      const nextPage = page + 1;
      const rows = await fetchProducts(filters, nextPage, isOwner);
      setProducts((current) => [...current, ...rows]);
      setPage(nextPage);
      setHasMore(rows.length === PAGE_SIZE);
    } catch {
      setHasMore(false);
    } finally {
      setLoadingMore(false);
    }
  }, [filters, hasMore, isOwner, loading, loadingMore, page]);

  const handleExport = async () => {
    setExportError(null);
    setBusyMessage(t("products.preparingExport"));
    try {
      const all = await fetchAllProducts(isOwner);
      const csv = toCsv(all, categories, isOwner);
      await saveTextFile(`products-${new Date().toISOString().slice(0, 10)}.csv`, csv);
      setBusyMessage(null);
    } catch (failure) {
      setBusyMessage(null);
      setExportError(errorKeyOr(failure, "products.exportFailed"));
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TextInput
          style={styles.search}
          placeholder={t("products.searchPlaceholder")}
          accessibilityLabel={t("products.searchPlaceholder")}
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
          autoCorrect={false}
        />

        <View style={styles.filterRow}>
          <FilterChip
            label={t("products.allCategories")}
            selected={categoryId === null}
            onPress={() => {
              setCategoryId(null);
              setSubCategoryId(null);
            }}
          />
          {mainCategories(categories).map((category) => (
            <FilterChip
              key={category.id}
              label={categoryLabel(category, i18n?.language)}
              selected={categoryId === category.id}
              onPress={() => {
                setCategoryId(category.id === categoryId ? null : category.id);
                setSubCategoryId(null);
              }}
            />
          ))}
        </View>

        {categoryId && subCategoriesOf(categories, categoryId).length > 0 && (
          <View style={styles.filterRow}>
            <FilterChip
              label={t("products.catAllSubs")}
              selected={subCategoryId === null}
              onPress={() => setSubCategoryId(null)}
            />
            {subCategoriesOf(categories, categoryId).map((sub) => (
              <FilterChip
                key={sub.id}
                label={categoryLabel(sub, i18n?.language)}
                selected={subCategoryId === sub.id}
                onPress={() => setSubCategoryId(sub.id === subCategoryId ? null : sub.id)}
              />
            ))}
          </View>
        )}

        <View style={styles.filterRow}>
          <FilterChip
            label={t("products.lowStock")}
            selected={lowStockOnly}
            onPress={() => setLowStockOnly((value) => !value)}
          />
          <FilterChip
            label={t("products.statusActive")}
            selected={status === "active"}
            onPress={() => setStatus("active")}
          />
          <FilterChip
            label={t("products.statusInactive")}
            selected={status === "inactive"}
            onPress={() => setStatus("inactive")}
          />
          <FilterChip
            label={t("products.statusAll")}
            selected={status === "all"}
            onPress={() => setStatus("all")}
          />
        </View>

        {isOwner && (
          <>
            <View style={styles.actionRow}>
              <ActionButton
                label={t("products.addNew")}
                onPress={() => router.push("/(app)/products/new")}
              />
              <ActionButton
                label={t("products.importCsv")}
                onPress={() => router.push("/(app)/products/import")}
              />
              <ActionButton label={t("products.exportCsv")} onPress={handleExport} />
              <ActionButton label={t("products.bulkPrice")} onPress={() => setBulkOpen(true)} />
              <ActionButton
                label={t("products.manageCategories")}
                onPress={() => router.push("/(app)/products/categories")}
              />
            </View>
            {exportError ? <InlineError reasonKey={exportError} /> : null}
          </>
        )}
      </View>

      {busyMessage && <Text style={styles.busy}>{busyMessage}</Text>}

      {loading ? (
        <ActivityIndicator style={styles.loader} />
      ) : loadError ? (
        <LoadError title={t("products.loadError")} reasonKey={loadError} onRetry={load} />
      ) : (
        <FlatList
          data={products}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <ProductRow
              product={item}
              showCost={isOwner}
              onPress={isOwner ? () => router.push(`/(app)/products/${item.id}`) : undefined}
            />
          )}
          getItemLayout={(_, index) => ({
            length: PRODUCT_ROW_HEIGHT,
            offset: PRODUCT_ROW_HEIGHT * index,
            index,
          })}
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          ListEmptyComponent={
            filtered ? (
              <EmptyState icon="search" title={t("products.empty")} />
            ) : (
              <EmptyState
                icon="package"
                title={t("products.emptyTitle")}
                message={t(isOwner ? "products.emptyHintOwner" : "products.emptyHintCashier")}
                action={
                  isOwner ? (
                    <BigButton
                      label={t("products.emptyAddFirst")}
                      onPress={() => router.push("/(app)/products/new")}
                    />
                  ) : undefined
                }
              />
            )
          }
          ListFooterComponent={loadingMore ? <ActivityIndicator style={styles.loader} /> : null}
          windowSize={10}
          removeClippedSubviews
        />
      )}

      <BulkPriceModal
        visible={bulkOpen}
        categories={categories}
        onClose={() => setBulkOpen(false)}
        onApplied={() => {
          setBulkOpen(false);
          load();
        }}
      />
    </View>
  );
}

function FilterChip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: selected }}
      style={[styles.chip, selected && styles.chipSelected]}
      onPress={onPress}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

function ActionButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" style={styles.action} onPress={onPress}>
      <Text style={styles.actionText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  header: { padding: 16, gap: 12, borderBottomWidth: 1, borderBottomColor: "#eee" },
  search: {
    minHeight: 52,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#ccc",
    paddingHorizontal: 16,
    fontSize: 16,
  },
  filterRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  actionRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 18, backgroundColor: "#eee" },
  chipSelected: { backgroundColor: "#1d7a46" },
  chipText: { fontSize: 14, color: "#333" },
  chipTextSelected: { color: "#fff", fontWeight: "600" },
  action: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: "#1d7a46",
  },
  actionText: { color: "#fff", fontWeight: "600", fontSize: 15 },
  loader: { marginVertical: 24 },
  busy: { textAlign: "center", padding: 12, color: "#1d7a46" },
});
