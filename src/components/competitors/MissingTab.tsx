import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { BigButton } from "@/src/components/BigButton";
import { CardAction, CatalogCard } from "@/src/components/competitors/CatalogCard";
import { CatalogFilters } from "@/src/components/competitors/CatalogFilters";
import { ProductSearchPicker } from "@/src/components/stock/ProductSearchPicker";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { LoadError } from "@/src/components/ui/LoadError";
import {
  DEFAULT_FILTERS,
  type CatalogRow,
  type ListFilters,
  type ShopRow,
} from "@/src/lib/competitors/catalog";
import {
  confirmMatch,
  fetchCatalogCategories,
  fetchShops,
  setItemDecision,
} from "@/src/lib/competitors/shops";
import { useCatalogList } from "@/src/lib/competitors/useCatalogList";
import { showToast } from "@/src/lib/dialog/store";
import { errorKey } from "@/src/lib/errors/userMessage";
import { isolateLtr } from "@/src/lib/text/bidi";
import { Text } from "@/src/theme/Text";
import { colors } from "@/src/theme/tokens";

// Owner only. Their products that we do not have: filter, sort, then decide.
export function MissingTab({ onChanged }: { onChanged: () => void }) {
  const { t } = useTranslation();
  const [filters, setFilters] = useState<ListFilters>(DEFAULT_FILTERS);
  const [shops, setShops] = useState<ShopRow[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const list = useCatalogList("missing", filters);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pickingId, setPickingId] = useState<string | null>(null);

  useEffect(() => {
    fetchShops()
      .then(setShops)
      .catch(() => setShops([]));
  }, []);
  useEffect(() => {
    fetchCatalogCategories("missing", filters.shopId)
      .then(setCategories)
      .catch(() => setCategories([]));
  }, [filters.shopId]);

  const decide = async (row: CatalogRow, run: () => Promise<unknown>, doneKey: string) => {
    setBusyId(row.id);
    try {
      await run();
      list.remove(row.id);
      setPickingId(null);
      showToast({ text: t(doneKey), tone: "success" });
      onChanged();
    } catch (failure) {
      const already = failure instanceof Error && /already matched/i.test(failure.message);
      showToast({
        text: t(already ? "competitors.confirmTab.alreadyMatched" : errorKey(failure)),
        tone: "info",
      });
    } finally {
      setBusyId(null);
    }
  };

  const header = (
    <View>
      <Text style={styles.hint}>{t("competitors.missingTab.hint")}</Text>
      <CatalogFilters
        filters={filters}
        shops={shops}
        categories={categories}
        onChange={setFilters}
      />
      <Text style={styles.count}>
        {t("competitors.catalog.count", { count: isolateLtr(String(list.total)) })}
      </Text>
    </View>
  );

  if (list.error && list.rows.length === 0) {
    return (
      <LoadError
        title={t("competitors.catalog.loadError")}
        reasonKey={list.error}
        onRetry={() => void list.reload()}
      />
    );
  }

  return (
    <FlatList
      data={list.rows}
      keyExtractor={(row) => row.id}
      contentContainerStyle={styles.list}
      initialNumToRender={8}
      windowSize={7}
      onEndReachedThreshold={0.5}
      onEndReached={() => void list.loadMore()}
      ListHeaderComponent={header}
      ListEmptyComponent={
        list.loading ? (
          <ActivityIndicator style={{ marginTop: 24 }} />
        ) : (
          <EmptyState
            icon="package"
            title={t("competitors.missingTab.emptyTitle")}
            message={t("competitors.missingTab.emptyHint")}
          />
        )
      }
      ListFooterComponent={
        list.rows.length < list.total ? (
          <BigButton
            label={t("competitors.catalog.loadMore")}
            variant="secondary"
            onPress={() => void list.loadMore()}
            disabled={list.loadingMore}
          />
        ) : null
      }
      ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
      renderItem={({ item: row }) => (
        <CatalogCard row={row}>
          <CardAction
            primary
            label={t("competitors.missingTab.want")}
            disabled={busyId === row.id}
            onPress={() =>
              void decide(
                row,
                () => setItemDecision(row.id, "wanted"),
                "competitors.missingTab.wanted"
              )
            }
          />
          <CardAction
            label={t("competitors.missingTab.ignore")}
            disabled={busyId === row.id}
            onPress={() =>
              void decide(
                row,
                () => setItemDecision(row.id, "ignored"),
                "competitors.missingTab.ignored"
              )
            }
          />
          <CardAction
            label={t("competitors.missingTab.have")}
            disabled={busyId === row.id}
            onPress={() => setPickingId((current) => (current === row.id ? null : row.id))}
          />
          {pickingId === row.id ? (
            <View style={styles.picker}>
              <Text style={styles.hint}>{t("competitors.catalog.pickProduct")}</Text>
              <ProductSearchPicker
                excludeIds={[]}
                onPick={(product) =>
                  void decide(
                    row,
                    () => confirmMatch(row.id, product.id),
                    "competitors.confirmTab.confirmed"
                  )
                }
              />
            </View>
          ) : null}
        </CatalogCard>
      )}
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: 12, paddingBottom: 40 },
  hint: { fontSize: 13, color: colors.ink600, lineHeight: 18 },
  count: { fontSize: 13, color: colors.ink600, marginBottom: 8 },
  picker: { width: "100%", gap: 8, paddingTop: 8 },
});
