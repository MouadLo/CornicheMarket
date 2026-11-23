import { useState } from "react";
import { ActivityIndicator, FlatList, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { CardAction, CatalogCard, UsePhoto } from "@/src/components/competitors/CatalogCard";
import { ProductSearchPicker } from "@/src/components/stock/ProductSearchPicker";
import { BigButton } from "@/src/components/BigButton";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { LoadError } from "@/src/components/ui/LoadError";
import { Money } from "@/src/components/ui/Money";
import { StatusPill } from "@/src/components/ui/StatusPill";
import { DEFAULT_FILTERS, type CatalogRow } from "@/src/lib/competitors/catalog";
import { confirmMatch, rejectMatch } from "@/src/lib/competitors/shops";
import { useCatalogList } from "@/src/lib/competitors/useCatalogList";
import { showToast } from "@/src/lib/dialog/store";
import { errorKey } from "@/src/lib/errors/userMessage";
import { Text } from "@/src/theme/Text";
import { colors } from "@/src/theme/tokens";

// Owner only. "Notre produit <-> leur produit": confirming creates the tracked
// link (and its first price); nothing is ever confirmed automatically.
export function ConfirmTab({ onChanged }: { onChanged: () => void }) {
  const { t } = useTranslation();
  const list = useCatalogList("proposed", DEFAULT_FILTERS);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pickingId, setPickingId] = useState<string | null>(null);

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
        text: t(
          already
            ? "competitors.confirmTab.alreadyMatched"
            : errorKey(failure) || "competitors.confirmTab.error"
        ),
        tone: "info",
      });
    } finally {
      setBusyId(null);
    }
  };

  if (list.error && list.rows.length === 0) {
    return (
      <LoadError
        title={t("competitors.catalog.loadError")}
        reasonKey={list.error}
        onRetry={() => void list.reload()}
      />
    );
  }
  if (list.loading && list.rows.length === 0)
    return <ActivityIndicator style={{ marginTop: 40 }} />;

  return (
    <FlatList
      data={list.rows}
      keyExtractor={(row) => row.id}
      contentContainerStyle={styles.list}
      onEndReachedThreshold={0.5}
      onEndReached={() => void list.loadMore()}
      ListHeaderComponent={<Text style={styles.hint}>{t("competitors.confirmTab.hint")}</Text>}
      ListEmptyComponent={
        <EmptyState
          icon="scale"
          title={t("competitors.confirmTab.emptyTitle")}
          message={t("competitors.confirmTab.emptyHint")}
        />
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
      renderItem={({ item: row }) => (
        <CatalogCard
          row={row}
          header={
            <View style={styles.ours}>
              <View style={styles.flex}>
                <Text style={styles.label}>{t("competitors.confirmTab.ours")}</Text>
                <Text style={styles.ourName}>{row.candidate_product_name}</Text>
              </View>
              {row.candidate_selling_price_cents !== null ? (
                <Money cents={row.candidate_selling_price_cents} size="body" />
              ) : null}
              {row.match_uncertain ? (
                <StatusPill
                  label={t("competitors.confirmTab.uncertain")}
                  tone="warn"
                  icon="alert"
                />
              ) : null}
            </View>
          }
        >
          {row.candidate_product_id ? (
            <CardAction
              primary
              label={t("competitors.confirmTab.confirm")}
              disabled={busyId === row.id}
              onPress={() =>
                void decide(
                  row,
                  () => confirmMatch(row.id, row.candidate_product_id as string),
                  "competitors.confirmTab.confirmed"
                )
              }
            />
          ) : null}
          {row.image_url && row.candidate_product_id ? (
            <UsePhoto imageUrl={row.image_url} productId={row.candidate_product_id} />
          ) : null}
          <CardAction
            label={t("competitors.confirmTab.notSame")}
            disabled={busyId === row.id}
            onPress={() =>
              void decide(row, () => rejectMatch(row.id), "competitors.confirmTab.rejected")
            }
          />
          <CardAction
            label={t("competitors.confirmTab.other")}
            disabled={busyId === row.id}
            onPress={() => setPickingId((current) => (current === row.id ? null : row.id))}
          />
          {pickingId === row.id ? (
            <View style={styles.picker}>
              <Text style={styles.label}>{t("competitors.catalog.pickProduct")}</Text>
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
      ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: 12, paddingBottom: 40 },
  hint: { fontSize: 13, color: colors.ink600, lineHeight: 18, marginBottom: 12 },
  ours: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
    padding: 8,
    borderRadius: 8,
    backgroundColor: colors.brand100,
  },
  flex: { flex: 1, minWidth: 140 },
  label: { fontSize: 13, color: colors.ink600 },
  ourName: { fontSize: 16, fontWeight: "700", color: colors.ink900 },
  picker: { width: "100%", gap: 8, paddingTop: 8 },
});
