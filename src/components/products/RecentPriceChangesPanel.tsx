import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";
import { useTranslation } from "react-i18next";

import { EmptyState } from "@/src/components/ui/EmptyState";
import { LoadError } from "@/src/components/ui/LoadError";
import { Panel, panelMode } from "@/src/components/ui/Panel";
import { errorKey } from "@/src/lib/errors/userMessage";
import { categoryPathLabel } from "@/src/lib/products/categoryCatalog";
import {
  fetchRecentPriceChanges,
  type Category,
  type PriceChangeBatch,
} from "@/src/lib/products/queries";
import { formatPercent, undoPriceChangeWithConfirm } from "@/src/lib/products/undoPriceChangeFlow";
import { isolateLtr } from "@/src/lib/text/bidi";
import { formatLocaleDateTime } from "@/src/lib/text/dates";
import { Text } from "@/src/theme/Text";
import { colors, radius } from "@/src/theme/tokens";

type Props = {
  visible: boolean;
  categories: Category[];
  onClose: () => void;
  // Called after an undo, so the product list can be re-read.
  onUndone: () => void;
};

// Owner-only (the screen only offers it to the owner, and RLS returns no rows
// to anyone else): the last bulk price changes, each with an undo until it has
// been used.
export function RecentPriceChangesPanel({ visible, categories, onClose, onUndone }: Props) {
  const { t, i18n } = useTranslation();
  const { width } = useWindowDimensions();
  const [batches, setBatches] = useState<PriceChangeBatch[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setBatches(await fetchRecentPriceChanges(10));
    } catch (failure) {
      setLoadError(errorKey(failure));
    }
  }, []);

  useEffect(() => {
    if (visible) void load();
  }, [visible, load]);

  const scopeLabel = (batch: PriceChangeBatch) => {
    if (batch.source === "competitor") return t("products.priceChangeCompetitor");
    if (batch.category_id === null) return t("products.bulkAll");
    const category = categories.find((c) => c.id === batch.category_id);
    return category
      ? categoryPathLabel(category, categories, i18n?.language)
      : t("products.priceChangeCategoryGone");
  };

  const undo = async (batch: PriceChangeBatch) => {
    const result = await undoPriceChangeWithConfirm(batch, t);
    if (result) {
      await load();
      onUndone();
    }
  };

  // The Products screen has no side column to dock into: on a wide screen the
  // panel floats over the end edge (absolute start/end don't follow dir="rtl"
  // on web, so the side is chosen here); on a narrow one Panel opens full screen.
  const docked = panelMode(width) === "docked";
  const side =
    Platform.OS !== "web" ? { end: 0 } : i18n?.language === "ar" ? { left: 0 } : { right: 0 };
  if (!visible) return null;
  const panel = (
    <Panel visible={visible} title={t("products.priceChangesRecent")} onClose={onClose}>
      {loadError ? (
        <LoadError
          title={t("products.priceChangesLoadError")}
          reasonKey={loadError}
          onRetry={() => void load()}
        />
      ) : batches === null ? (
        <ActivityIndicator style={styles.loading} />
      ) : batches.length === 0 ? (
        <EmptyState icon="tag" title={t("products.priceChangesEmpty")} />
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {batches.map((batch) => (
            <View key={batch.id} style={styles.row}>
              <Text style={styles.date}>
                {isolateLtr(
                  formatLocaleDateTime(new Date(batch.created_at), i18n?.language ?? "fr")
                )}
              </Text>
              <Text style={styles.scope}>{scopeLabel(batch)}</Text>
              <Text style={styles.detail}>
                {batch.source === "competitor"
                  ? t("products.priceChangeLineCompetitor", { count: batch.product_count })
                  : t("products.priceChangeLine", {
                      percent: isolateLtr(formatPercent(batch.percent)),
                      count: batch.product_count,
                    })}
              </Text>
              {batch.reverted_at ? (
                <Text style={styles.tag}>{t("products.priceChangeReverted")}</Text>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  style={styles.undo}
                  onPress={() => void undo(batch)}
                >
                  <Text style={styles.undoText}>{t("products.priceChangeUndo")}</Text>
                </Pressable>
              )}
            </View>
          ))}
        </ScrollView>
      )}
    </Panel>
  );
  return docked ? <View style={[styles.dock, side]}>{panel}</View> : panel;
}

const styles = StyleSheet.create({
  dock: {
    position: "absolute",
    top: 0,
    bottom: 0,
    flexDirection: "row",
    zIndex: 10,
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 8,
  },
  loading: { padding: 24 },
  list: { padding: 16, gap: 12 },
  row: {
    gap: 4,
    padding: 12,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  date: { color: colors.ink600, fontSize: 13 },
  scope: { color: colors.ink900, fontSize: 16, fontWeight: "600" },
  detail: { color: colors.ink700, fontSize: 14 },
  tag: { color: colors.ink600, fontSize: 13, fontWeight: "600", marginTop: 4 },
  undo: { alignSelf: "flex-start", minHeight: 44, justifyContent: "center", marginTop: 4 },
  undoText: { color: colors.brand600, fontSize: 15, fontWeight: "600" },
});
