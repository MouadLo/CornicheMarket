import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Linking, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { BigButton } from "@/src/components/BigButton";
import { CardAction, CatalogCard } from "@/src/components/competitors/CatalogCard";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { Chip } from "@/src/components/ui/Chip";
import { Field } from "@/src/components/ui/Field";
import { LoadError } from "@/src/components/ui/LoadError";
import { Segmented } from "@/src/components/ui/Segmented";
import {
  DEFAULT_FILTERS,
  NOTE_MAX,
  sourcingCsvRows,
  sourcingShareText,
  validateNote,
  whatsappUrl,
  type CatalogRow,
  type SourcingStatus,
} from "@/src/lib/competitors/catalog";
import { fetchCatalogPage, setItemDecision, updateSourcing } from "@/src/lib/competitors/shops";
import { useCatalogList } from "@/src/lib/competitors/useCatalogList";
import { showToast } from "@/src/lib/dialog/store";
import { errorKey } from "@/src/lib/errors/userMessage";
import { exportTablesAsCsv } from "@/src/lib/reports/export";
import { fetchSuppliers, type Supplier } from "@/src/lib/stock/queries";
import { formatMAD } from "@/src/lib/money";
import { Text } from "@/src/theme/Text";
import { colors } from "@/src/theme/tokens";

const STATUSES: SourcingStatus[] = ["to_ask", "asked", "found"];

// Owner only. What the owner wants to add: their price as a reference, a note,
// an optional supplier and a status; share the list, export it, or create the
// product (the item is then linked to it).
export function SourcingTab({ onChanged }: { onChanged: () => void }) {
  const { t } = useTranslation();
  const list = useCatalogList("wanted", DEFAULT_FILTERS);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetchSuppliers()
      .then(setSuppliers)
      .catch(() => setSuppliers([]));
  }, []);

  // The selection, or every wanted item (not only the pages already loaded).
  const itemsToShare = async (): Promise<CatalogRow[]> => {
    if (selected.size > 0) return list.rows.filter((row) => selected.has(row.id));
    const all = [...list.rows];
    while (all.length < list.total) {
      const page = await fetchCatalogPage("wanted", DEFAULT_FILTERS, all.length);
      if (page.length === 0) break;
      all.push(...page);
    }
    return all;
  };

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const share = async () => {
    let chosen: CatalogRow[];
    try {
      chosen = await itemsToShare();
    } catch {
      showToast({ text: t("competitors.sourcingTab.shareError"), tone: "info" });
      return;
    }
    const text = sourcingShareText(chosen, {
      heading: t("competitors.sourcingTab.shareHeading"),
      theirPrice: (price) => t("competitors.sourcingTab.shareTheirPrice", { price }),
      noPrice: t("competitors.sourcingTab.shareNoPrice"),
    });
    try {
      await Linking.openURL(whatsappUrl(text));
    } catch {
      showToast({ text: t("competitors.sourcingTab.shareError"), tone: "info" });
    }
  };

  const exportCsv = async () => {
    let chosen: CatalogRow[];
    try {
      chosen = await itemsToShare();
    } catch {
      showToast({ text: t("competitors.sourcingTab.shareError"), tone: "info" });
      return;
    }
    const statusName = (status: SourcingStatus) => t(`competitors.sourcingTab.status.${status}`);
    try {
      await exportTablesAsCsv("a-sourcer.csv", [
        {
          title: t("competitors.sourcingTab.csvTitle"),
          columns: [
            t("competitors.sourcingTab.csvName"),
            t("competitors.sourcingTab.csvPrice"),
            t("competitors.sourcingTab.csvRegular"),
            t("competitors.sourcingTab.csvShop"),
            t("competitors.sourcingTab.csvSupplier"),
            t("competitors.sourcingTab.csvStatus"),
            t("competitors.sourcingTab.csvNote"),
            t("competitors.sourcingTab.csvLink"),
          ],
          rows: sourcingCsvRows(chosen, statusName),
        },
      ]);
    } catch {
      showToast({ text: t("competitors.sourcingTab.shareError"), tone: "info" });
    }
  };

  const remove = async (row: CatalogRow) => {
    try {
      await setItemDecision(row.id, "missing");
      list.remove(row.id);
      onChanged();
    } catch (failure) {
      showToast({ text: t(errorKey(failure)), tone: "info" });
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

  return (
    <FlatList
      data={list.rows}
      keyExtractor={(row) => row.id}
      contentContainerStyle={styles.list}
      extraData={selected}
      onEndReachedThreshold={0.5}
      onEndReached={() => void list.loadMore()}
      ListHeaderComponent={
        <View style={styles.header}>
          <Text style={styles.hint}>{t("competitors.sourcingTab.hint")}</Text>
          {list.rows.length > 0 ? (
            <View style={styles.headerActions}>
              <BigButton
                label={
                  selected.size > 0
                    ? t("competitors.sourcingTab.shareSelected", { count: selected.size })
                    : t("competitors.sourcingTab.share")
                }
                onPress={() => void share()}
              />
              <BigButton
                label={t("competitors.sourcingTab.exportCsv")}
                variant="secondary"
                onPress={() => void exportCsv()}
              />
            </View>
          ) : null}
        </View>
      }
      ListEmptyComponent={
        list.loading ? (
          <ActivityIndicator style={{ marginTop: 24 }} />
        ) : (
          <EmptyState
            icon="truck"
            title={t("competitors.sourcingTab.emptyTitle")}
            message={t("competitors.sourcingTab.emptyHint")}
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
        <WantedCard
          row={row}
          suppliers={suppliers}
          selected={selected.has(row.id)}
          onToggle={() => toggle(row.id)}
          onSaved={(values) => list.patch(row.id, values)}
          onRemove={() => void remove(row)}
        />
      )}
    />
  );
}

function WantedCard({
  row,
  suppliers,
  selected,
  onToggle,
  onSaved,
  onRemove,
}: {
  row: CatalogRow;
  suppliers: Supplier[];
  selected: boolean;
  onToggle: () => void;
  onSaved: (values: Partial<CatalogRow>) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const [note, setNote] = useState(row.sourcing_note ?? "");
  const [supplierId, setSupplierId] = useState<string | null>(row.sourcing_supplier_id);
  const [status, setStatus] = useState<SourcingStatus>(row.sourcing_status ?? "to_ask");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [choosing, setChoosing] = useState(false);

  const supplierName =
    suppliers.find((s) => s.id === supplierId)?.name ?? row.sourcing_supplier_name ?? null;

  const save = async () => {
    const checked = validateNote(note);
    if (!checked.ok) {
      setError(t("competitors.sourcingTab.noteTooLong"));
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await updateSourcing(row.id, { note: checked.note, supplierId, status });
      onSaved({
        sourcing_note: checked.note,
        sourcing_supplier_id: supplierId,
        sourcing_supplier_name: supplierName,
        sourcing_status: status,
      });
      showToast({ text: t("competitors.sourcingTab.saved"), tone: "success" });
    } catch (failure) {
      setError(t(errorKey(failure)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <CatalogCard
      row={row}
      header={
        <Chip
          label={t("competitors.sourcingTab.select", { name: row.name })}
          selected={selected}
          onPress={onToggle}
        />
      }
    >
      <View style={styles.edit}>
        <Text style={styles.hint}>
          {t("competitors.sourcingTab.theirPrice")}:{" "}
          {row.price_cents === null ? "-" : formatMAD(row.price_cents)}
        </Text>
        <Segmented
          options={STATUSES.map((key) => ({
            key,
            label: t(`competitors.sourcingTab.status.${key}`),
          }))}
          value={status}
          onChange={setStatus}
        />
        <Field
          label={t("competitors.sourcingTab.noteLabel")}
          placeholder={t("competitors.sourcingTab.notePlaceholder")}
          value={note}
          onChangeText={setNote}
          maxLength={NOTE_MAX}
          multiline
        />
        <Text style={styles.hint}>
          {t("competitors.sourcingTab.supplierLabel")}:{" "}
          {supplierName ?? t("competitors.sourcingTab.supplierNone")}
        </Text>
        <CardAction
          label={t("competitors.sourcingTab.supplierChange")}
          onPress={() => setChoosing((open) => !open)}
        />
        {choosing ? (
          <View style={styles.chips}>
            <Chip
              label={t("competitors.sourcingTab.supplierNone")}
              selected={supplierId === null}
              onPress={() => {
                setSupplierId(null);
                setChoosing(false);
              }}
            />
            {suppliers.map((supplier) => (
              <Chip
                key={supplier.id}
                label={supplier.name}
                selected={supplierId === supplier.id}
                onPress={() => {
                  setSupplierId(supplier.id);
                  setChoosing(false);
                }}
              />
            ))}
          </View>
        ) : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <View style={styles.row}>
          <CardAction
            primary
            label={t("competitors.sourcingTab.save")}
            onPress={() => void save()}
            disabled={busy}
          />
          <CardAction
            label={t("competitors.sourcingTab.createProduct")}
            onPress={() =>
              router.push({
                pathname: "/(app)/products/new",
                params: { competitorItemId: row.id, name: row.name },
              })
            }
          />
          <CardAction danger label={t("competitors.sourcingTab.remove")} onPress={onRemove} />
        </View>
      </View>
    </CatalogCard>
  );
}

const styles = StyleSheet.create({
  list: { padding: 12, paddingBottom: 40 },
  header: { gap: 12, marginBottom: 12 },
  headerActions: { gap: 8 },
  hint: { fontSize: 13, color: colors.ink600, lineHeight: 18 },
  edit: { width: "100%", gap: 8, paddingTop: 4 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  error: { fontSize: 13, color: colors.danger700 },
});
