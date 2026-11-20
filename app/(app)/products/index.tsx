import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { useTranslation } from "react-i18next";

import { BigButton } from "@/src/components/BigButton";
import { Chip } from "@/src/components/ui/Chip";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { Icon, type IconName } from "@/src/components/ui/Icon";
import { InlineError } from "@/src/components/ui/InlineError";
import { ListRow } from "@/src/components/ui/ListRow";
import { LoadError } from "@/src/components/ui/LoadError";
import { Panel } from "@/src/components/ui/Panel";
import { errorKey, errorKeyOr } from "@/src/lib/errors/userMessage";
import { BulkPriceModal } from "@/src/components/products/BulkPriceModal";
import { RecentPriceChangesPanel } from "@/src/components/products/RecentPriceChangesPanel";
import { PRODUCT_ROW_HEIGHT, ProductRow } from "@/src/components/products/ProductRow";
import { useAuth } from "@/src/lib/auth/AuthProvider";
import { saveTextFile } from "@/src/lib/files";
import { toCsv } from "@/src/lib/products/csv";
import {
  fetchAllProducts,
  fetchCategories,
  fetchProduct,
  fetchProducts,
  PAGE_SIZE,
  type Category,
  type Product,
  type ProductFilters,
  type ProductStatusFilter,
} from "@/src/lib/products/queries";
import { categoryLabel } from "@/src/lib/products/categoryCatalog";
import { familyIds, mainCategories, subCategoriesOf } from "@/src/lib/products/categories";
import {
  clampIndex,
  clearPlace,
  filtersKeyOf,
  peekPlace,
  placeApplies,
  rememberPlace,
  takePlace,
  type ListPlace,
} from "@/src/lib/products/listPlace";
import { activeFilterCount, isCompactProductsList } from "@/src/lib/products/listFilters";
import { useDebouncedValue } from "@/src/lib/useDebouncedValue";
import { Text } from "@/src/theme/Text";
import { colors } from "@/src/theme/tokens";

export default function ProductsScreen() {
  const { profile } = useAuth();
  const { t, i18n } = useTranslation();
  const isOwner = profile?.role === "owner";
  const compact = isCompactProductsList(useWindowDimensions().width);

  // A remembered place at mount means this screen was REMOUNTED after the owner
  // went to edit a product (web does this): start from the filters they had,
  // then re-load down to where they were. If the screen stayed mounted (native)
  // there is no place yet at mount; the focus effect below handles that case.
  const [restore] = useState<ListPlace | null>(() => peekPlace());
  const restoreRef = useRef<ListPlace | null>(restore);

  const [search, setSearch] = useState(restore?.filters.search ?? "");
  const [categoryId, setCategoryId] = useState<string | null>(restore?.filters.categoryId ?? null);
  const [subCategoryId, setSubCategoryId] = useState<string | null>(
    restore?.filters.subCategoryId ?? null
  );
  const [lowStockOnly, setLowStockOnly] = useState(restore?.filters.lowStockOnly ?? false);
  const [status, setStatus] = useState<ProductStatusFilter>(restore?.filters.status ?? "active");

  const [categories, setCategories] = useState<Category[]>([]);
  const [categoriesLoaded, setCategoriesLoaded] = useState(false);
  const listRef = useRef<FlatList<Product>>(null);
  const scrollOffset = useRef(0);
  const seenFirstFocus = useRef(false);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [scrollTarget, setScrollTarget] = useState<{ index: number; viewPosition: number } | null>(
    null
  );
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
  const [recentOpen, setRecentOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [busyMessage, setBusyMessage] = useState<string | null>(null);

  const debouncedSearch = useDebouncedValue(search, 300);
  // "No match" and "nothing here yet" need different words and different next steps.
  const filtered =
    debouncedSearch.trim() !== "" || categoryId !== null || lowStockOnly || status !== "active";

  const rawFilters = useMemo<ProductFilters>(
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
  // Same filters, same object: a categories re-read that returns equal data must
  // not trigger a reload (it would also undo a restored scroll position).
  const filterSignature = JSON.stringify(rawFilters);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const filters = useMemo(() => rawFilters, [filterSignature]);

  const flashRow = useCallback((id: string) => {
    setHighlightId(id);
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(() => setHighlightId(null), 1500);
  }, []);
  useEffect(
    () => () => {
      if (highlightTimer.current) clearTimeout(highlightTimer.current);
    },
    []
  );

  const currentFilters = { search, categoryId, subCategoryId, lowStockOnly, status };
  const latest = useRef({ isOwner, key: filtersKeyOf(currentFilters) });
  latest.current = { isOwner, key: filtersKeyOf(currentFilters) };

  // Kept-mounted return (native): re-read just the edited product and swap it
  // in place, so the scroll position is untouched.
  const refreshEdited = useCallback(
    async (place: ListPlace) => {
      if (!placeApplies(place, latest.current.key) || !place.productId) return;
      const id = place.productId;
      let fresh: Product | null;
      try {
        fresh = await fetchProduct(id, latest.current.isOwner);
      } catch {
        return;
      }
      const f = place.filters;
      const matches =
        fresh !== null &&
        !(f.status === "active" && !fresh.active) &&
        !(f.status === "inactive" && fresh.active) &&
        !(f.lowStockOnly && !fresh.is_low_stock);
      setProducts((current) => {
        const at = current.findIndex((p) => p.id === id);
        if (at < 0) return current;
        const next = current.slice();
        if (fresh && matches) next[at] = fresh;
        else next.splice(at, 1);
        return next;
      });
      if (fresh && matches) flashRow(id);
    },
    [flashRow]
  );

  // Re-read on every return to this screen: a category may have been created
  // in the product form since.
  useFocusEffect(
    useCallback(() => {
      fetchCategories()
        .then((rows) => {
          setCategories(rows);
          setCategoriesLoaded(true);
        })
        .catch(() => {
          setCategories([]);
          setCategoriesLoaded(true);
        });
      // The first focus is the mount; only later ones are a return.
      if (!seenFirstFocus.current) {
        seenFirstFocus.current = true;
        return;
      }
      if (restoreRef.current) return;
      const place = takePlace();
      if (place) void refreshEdited(place);
    }, [refreshEdited])
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

  // Remount with a remembered place: load pages 0..loadedPages, then land on it.
  const restoreLoad = useCallback(
    async (place: ListPlace) => {
      setLoading(true);
      setLoadError(null);
      let rows: Product[] = [];
      let reached = 0;
      let more = true;
      try {
        for (let p = 0; p <= place.loadedPages && more; p++) {
          const batch = await fetchProducts(filters, p, isOwner);
          rows = rows.concat(batch);
          reached = p;
          more = batch.length === PAGE_SIZE;
        }
      } catch {
        await load();
        return;
      }
      setProducts(rows);
      setPage(reached);
      setHasMore(more);
      const at = place.productId ? rows.findIndex((r) => r.id === place.productId) : -1;
      // Gone from the pages (renamed, filtered out): keep the same position.
      const index = at >= 0 ? at : clampIndex(place.index, rows.length);
      setScrollTarget({ index, viewPosition: place.productId ? 0.2 : 0 });
      if (at >= 0 && place.productId) flashRow(place.productId);
      setLoading(false);
    },
    [filters, isOwner, load, flashRow]
  );

  // Category filters resolve to ids only once categories are known.
  const restoreReady = !restore?.filters.categoryId || categoriesLoaded;
  useEffect(() => {
    const pending = restoreRef.current;
    if (pending) {
      if (!restoreReady) return;
      restoreRef.current = null;
      clearPlace();
      void restoreLoad(pending);
      return;
    }
    load();
  }, [load, restoreLoad, restoreReady]);

  useEffect(() => {
    if (!scrollTarget || loading) return;
    const timer = setTimeout(() => {
      listRef.current?.scrollToIndex({ ...scrollTarget, animated: false });
      setScrollTarget(null);
    }, 50);
    return () => clearTimeout(timer);
  }, [scrollTarget, loading]);

  const openProduct = (item: Product) => {
    rememberPlace({
      productId: item.id,
      index: products.findIndex((p) => p.id === item.id),
      loadedPages: page,
      filters: currentFilters,
    });
    router.push(`/(app)/products/${item.id}`);
  };
  const openNew = () => {
    rememberPlace({
      productId: null,
      index: Math.floor(scrollOffset.current / PRODUCT_ROW_HEIGHT),
      loadedPages: page,
      filters: currentFilters,
    });
    router.push("/(app)/products/new");
  };

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

  const filterCount = activeFilterCount({ categoryId, lowStockOnly, status });
  const clearFilters = () => {
    setCategoryId(null);
    setSubCategoryId(null);
    setLowStockOnly(false);
    setStatus("active");
  };
  // Names what is narrowing the list, so a short list is never a mystery.
  const selectedCategory = categories.find((c) => c.id === (subCategoryId ?? categoryId));
  const filterSummary = [
    selectedCategory ? categoryLabel(selectedCategory, i18n?.language) : null,
    lowStockOnly ? t("products.lowStock") : null,
    status === "inactive" ? t("products.statusInactive") : null,
    status === "all" ? t("products.statusAll") : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const categoryChips = (
    <>
      <View style={styles.filterRow}>
        <Chip
          label={t("products.allCategories")}
          selected={categoryId === null}
          onPress={() => {
            setCategoryId(null);
            setSubCategoryId(null);
          }}
        />
        {mainCategories(categories).map((category) => (
          <Chip
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
          <Chip
            label={t("products.catAllSubs")}
            selected={subCategoryId === null}
            onPress={() => setSubCategoryId(null)}
          />
          {subCategoriesOf(categories, categoryId).map((sub) => (
            <Chip
              key={sub.id}
              label={categoryLabel(sub, i18n?.language)}
              selected={subCategoryId === sub.id}
              onPress={() => setSubCategoryId(sub.id === subCategoryId ? null : sub.id)}
            />
          ))}
        </View>
      )}
    </>
  );

  const statusChips = (
    <View style={styles.filterRow}>
      <Chip
        label={t("products.lowStock")}
        selected={lowStockOnly}
        onPress={() => setLowStockOnly((value) => !value)}
      />
      <Chip
        label={t("products.statusActive")}
        selected={status === "active"}
        onPress={() => setStatus("active")}
      />
      <Chip
        label={t("products.statusInactive")}
        selected={status === "inactive"}
        onPress={() => setStatus("inactive")}
      />
      <Chip
        label={t("products.statusAll")}
        selected={status === "all"}
        onPress={() => setStatus("all")}
      />
    </View>
  );

  const secondaryActions: { icon: IconName; label: string; onPress: () => void }[] = [
    {
      icon: "upload",
      label: t("products.importCsv"),
      onPress: () => router.push("/(app)/products/import"),
    },
    { icon: "download", label: t("products.exportCsv"), onPress: () => void handleExport() },
    { icon: "tag", label: t("products.bulkPrice"), onPress: () => setBulkOpen(true) },
    {
      icon: "undo",
      label: t("products.priceChangesRecent"),
      onPress: () => setRecentOpen(true),
    },
    {
      icon: "clipboard",
      label: t("products.manageCategories"),
      onPress: () => router.push("/(app)/products/categories"),
    },
  ];

  return (
    <View style={styles.container}>
      <View style={[styles.header, compact && styles.headerCompact]}>
        <TextInput
          style={styles.search}
          placeholder={t("products.searchPlaceholder")}
          accessibilityLabel={t("products.searchPlaceholder")}
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
          autoCorrect={false}
        />

        {compact ? (
          <>
            <View style={styles.toolbar}>
              <ToolbarButton
                icon="sliders"
                label={
                  filterCount > 0
                    ? t("products.filtersCount", { count: filterCount })
                    : t("products.filters")
                }
                active={filterCount > 0}
                onPress={() => setFiltersOpen(true)}
              />
              {isOwner && (
                <>
                  <Pressable
                    accessibilityRole="button"
                    style={[styles.action, styles.toolbarAction]}
                    onPress={() => openNew()}
                  >
                    <Text style={styles.actionText} numberOfLines={1}>
                      {t("products.addNew")}
                    </Text>
                  </Pressable>
                  <ToolbarButton
                    icon="more"
                    label={t("products.moreActions")}
                    onPress={() => setActionsOpen(true)}
                  />
                </>
              )}
            </View>
            {filterCount > 0 && (
              <View style={styles.summaryRow}>
                <Text style={styles.summaryText} numberOfLines={1}>
                  {filterSummary}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t("products.clearFilters")}
                  style={styles.summaryClear}
                  onPress={clearFilters}
                >
                  <Text style={styles.summaryClearText}>{t("products.clearShort")}</Text>
                </Pressable>
              </View>
            )}
          </>
        ) : (
          <>
            {categoryChips}
            {statusChips}
            {isOwner && (
              <View style={styles.actionRow}>
                <ActionButton label={t("products.addNew")} onPress={() => openNew()} />
                {secondaryActions.map((action) => (
                  <ActionButton key={action.icon} label={action.label} onPress={action.onPress} />
                ))}
              </View>
            )}
          </>
        )}
        {isOwner && exportError ? <InlineError reasonKey={exportError} /> : null}
      </View>

      {busyMessage && <Text style={styles.busy}>{busyMessage}</Text>}

      {loading ? (
        <ActivityIndicator style={styles.loader} />
      ) : loadError ? (
        <LoadError title={t("products.loadError")} reasonKey={loadError} onRetry={load} />
      ) : (
        <FlatList
          ref={listRef}
          data={products}
          extraData={highlightId}
          onScroll={(e) => {
            scrollOffset.current = e.nativeEvent.contentOffset.y;
          }}
          scrollEventThrottle={100}
          onScrollToIndexFailed={(info) =>
            listRef.current?.scrollToOffset({
              offset: info.index * PRODUCT_ROW_HEIGHT,
              animated: false,
            })
          }
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <ProductRow
              product={item}
              showCost={isOwner}
              highlighted={item.id === highlightId}
              onPress={isOwner ? () => openProduct(item) : undefined}
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
                    <BigButton label={t("products.emptyAddFirst")} onPress={() => openNew()} />
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

      <Panel
        visible={compact && filtersOpen}
        title={t("products.filters")}
        onClose={() => setFiltersOpen(false)}
        footer={
          <>
            {filterCount > 0 && (
              <View style={styles.flex}>
                <BigButton
                  label={t("products.clearFilters")}
                  variant="secondary"
                  onPress={clearFilters}
                />
              </View>
            )}
            <View style={styles.flex}>
              <BigButton label={t("products.showResults")} onPress={() => setFiltersOpen(false)} />
            </View>
          </>
        }
      >
        <ScrollView contentContainerStyle={styles.panelBody}>
          <Text style={styles.panelHeading}>{t("products.filterCategory")}</Text>
          {categoryChips}
          <Text style={styles.panelHeading}>{t("products.filterStatus")}</Text>
          {statusChips}
        </ScrollView>
      </Panel>

      <Panel
        visible={compact && actionsOpen}
        title={t("products.moreActions")}
        onClose={() => setActionsOpen(false)}
      >
        {secondaryActions.map((action) => (
          <ListRow
            key={action.icon}
            title={action.label}
            leading={<Icon name={action.icon} />}
            onPress={() => {
              setActionsOpen(false);
              action.onPress();
            }}
          />
        ))}
      </Panel>

      <BulkPriceModal
        visible={bulkOpen}
        categories={categories}
        onClose={() => setBulkOpen(false)}
        onApplied={() => {
          setBulkOpen(false);
          load();
        }}
      />

      {isOwner && (
        <RecentPriceChangesPanel
          visible={recentOpen}
          categories={categories}
          onClose={() => setRecentOpen(false)}
          onUndone={load}
        />
      )}
    </View>
  );
}

function ToolbarButton({
  icon,
  label,
  active,
  onPress,
}: {
  icon: IconName;
  label: string;
  active?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      style={[styles.toolbarButton, active && styles.toolbarButtonActive]}
      onPress={onPress}
    >
      <Icon name={icon} size={20} color={colors.brand700} />
      <Text style={styles.toolbarButtonText} numberOfLines={1}>
        {label}
      </Text>
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
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    padding: 16,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    backgroundColor: colors.surface,
  },
  headerCompact: { paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  flex: { flex: 1 },
  toolbar: { flexDirection: "row", gap: 8 },
  toolbarButton: {
    flex: 1,
    minWidth: 0,
    minHeight: 48,
    paddingHorizontal: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.brand700,
    backgroundColor: colors.surface,
  },
  toolbarButtonActive: { backgroundColor: colors.brand100 },
  toolbarButtonText: { flexShrink: 1, color: colors.brand700, fontWeight: "600", fontSize: 15 },
  toolbarAction: {
    flex: 1,
    minWidth: 0,
    minHeight: 48,
    paddingVertical: 0,
    paddingHorizontal: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  summaryRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  summaryText: { flex: 1, fontSize: 14, color: colors.ink600 },
  summaryClear: { minHeight: 44, minWidth: 48, alignItems: "center", justifyContent: "center" },
  summaryClearText: { color: colors.brand700, fontWeight: "700", fontSize: 15 },
  panelBody: { gap: 12 },
  panelHeading: { fontSize: 15, fontWeight: "700", color: colors.ink700, marginTop: 4 },
  search: {
    minHeight: 52,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.ink400,
    paddingHorizontal: 16,
    fontSize: 16,
    backgroundColor: colors.surface,
  },
  filterRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  actionRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  action: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: colors.brand700,
  },
  actionText: { color: colors.white, fontWeight: "600", fontSize: 15 },
  loader: { marginVertical: 24 },
  busy: { textAlign: "center", padding: 12, color: colors.brand700 },
});
