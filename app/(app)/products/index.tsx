import { router } from "expo-router";
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
import { useDebouncedValue } from "@/src/lib/useDebouncedValue";

export default function ProductsScreen() {
  const { profile } = useAuth();
  const { t } = useTranslation();
  const isOwner = profile?.role === "owner";

  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [status, setStatus] = useState<ProductStatusFilter>("active");

  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [busyMessage, setBusyMessage] = useState<string | null>(null);

  const debouncedSearch = useDebouncedValue(search, 300);

  const filters = useMemo<ProductFilters>(
    () => ({ search: debouncedSearch, categoryId, lowStockOnly, status }),
    [debouncedSearch, categoryId, lowStockOnly, status]
  );

  useEffect(() => {
    fetchCategories()
      .then(setCategories)
      .catch(() => setCategories([]));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await fetchProducts(filters, 0, isOwner);
      setProducts(rows);
      setPage(0);
      setHasMore(rows.length === PAGE_SIZE);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load products.");
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
    setBusyMessage(t("products.preparingExport"));
    try {
      const all = await fetchAllProducts(isOwner);
      const csv = toCsv(all, categories, isOwner);
      await saveTextFile(`products-${new Date().toISOString().slice(0, 10)}.csv`, csv);
      setBusyMessage(null);
    } catch (exportError) {
      setBusyMessage(null);
      setError(exportError instanceof Error ? exportError.message : t("products.exportFailed"));
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TextInput
          style={styles.search}
          placeholder={t("products.searchPlaceholder")}
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
          autoCorrect={false}
        />

        <View style={styles.filterRow}>
          <FilterChip
            label={t("products.allCategories")}
            selected={categoryId === null}
            onPress={() => setCategoryId(null)}
          />
          {categories.map((category) => (
            <FilterChip
              key={category.id}
              label={category.name}
              selected={categoryId === category.id}
              onPress={() => setCategoryId(category.id === categoryId ? null : category.id)}
            />
          ))}
        </View>

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
          </View>
        )}
      </View>

      {busyMessage && <Text style={styles.busy}>{busyMessage}</Text>}
      {error && <Text style={styles.error}>{error}</Text>}

      {loading ? (
        <ActivityIndicator style={styles.loader} />
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
          ListEmptyComponent={<Text style={styles.empty}>{t("products.empty")}</Text>}
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
    <Pressable style={[styles.chip, selected && styles.chipSelected]} onPress={onPress}>
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

function ActionButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.action} onPress={onPress}>
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
  empty: { textAlign: "center", marginTop: 40, color: "#666", fontSize: 15 },
  busy: { textAlign: "center", padding: 12, color: "#1d7a46" },
  error: { textAlign: "center", padding: 12, color: "#b3261e" },
});
