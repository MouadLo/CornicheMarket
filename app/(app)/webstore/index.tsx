import { Redirect, router, useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";

import { BigButton } from "@/src/components/BigButton";
import { Banner } from "@/src/components/ui/Banner";
import { Chip } from "@/src/components/ui/Chip";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { LoadError } from "@/src/components/ui/LoadError";
import { displayName, WebProductRow } from "@/src/components/webstore/WebProductRow";
import { useAuth } from "@/src/lib/auth/AuthProvider";
import { confirmDestructive } from "@/src/lib/confirmDestructive";
import { showToast } from "@/src/lib/dialog/store";
import { errorKey } from "@/src/lib/errors/userMessage";
import { filterProducts, WEB_FILTERS, type WebFilter } from "@/src/lib/webstore/filter";
import { fetchWebProducts, setPublished } from "@/src/lib/webstore/queries";
import { dropsBelowMinimum, feedStatus } from "@/src/lib/webstore/resolve";
import type { WebProduct } from "@/src/lib/webstore/types";
import { isolateBidi } from "@/src/lib/text/bidi";
import { Text } from "@/src/theme/Text";
import { colors, radius } from "@/src/theme/tokens";

const FILTER_KEY: Record<WebFilter, string> = {
  all: "webstore.filterAll",
  published: "webstore.filterPublished",
  hidden: "webstore.filterHidden",
  unlinked: "webstore.filterUnlinked",
  priceDiff: "webstore.filterPriceDiff",
  noPrice: "webstore.filterNoPrice",
};

// Owner only (a cashier is sent back to Vente). The products of the public
// webstore: what the site shows, what is published, and what is linked to the
// app's own products.
export default function WebstoreList() {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const isOwner = profile?.role === "owner";
  const [products, setProducts] = useState<WebProduct[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<WebFilter>("all");
  const [term, setTerm] = useState("");
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set());

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setProducts(await fetchWebProducts());
    } catch (failure) {
      setLoadError(errorKey(failure));
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (isOwner) void load();
    }, [isOwner, load])
  );

  const status = useMemo(() => feedStatus(products ?? []), [products]);
  const shown = useMemo(
    () => (products ? filterProducts(products, filter, term) : []),
    [products, filter, term]
  );

  const setBusy = (id: string, on: boolean) =>
    setBusyIds((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const patchLocal = (id: string, published: boolean) =>
    setProducts((list) => list && list.map((p) => (p.id === id ? { ...p, published } : p)));

  const togglePublished = async (product: WebProduct, published: boolean) => {
    if (!products || busyIds.has(product.id)) return;
    // Hiding the product that would leave the site with fewer than the minimum
    // makes the site ignore the whole list: ask first.
    if (!published && dropsBelowMinimum(products, product.id, false)) {
      const ok = await confirmDestructive(
        t("webstore.hideTitle"),
        t("webstore.hideMessage", { count: status.inFeed - 1, min: status.min }),
        t("webstore.hideConfirm"),
        t("common.cancel")
      );
      if (!ok) return;
    }
    setBusy(product.id, true);
    patchLocal(product.id, published);
    try {
      await setPublished(product.id, published);
    } catch {
      patchLocal(product.id, !published);
      showToast({ text: t("webstore.publishError"), tone: "info" });
    } finally {
      setBusy(product.id, false);
    }
  };

  if (profile && !isOwner) return <Redirect href="/(app)/sell" />;
  if (!isOwner) return null;

  if (loadError && !products) {
    return (
      <LoadError
        title={t("webstore.loadError")}
        reasonKey={loadError}
        onRetry={() => void load()}
      />
    );
  }
  if (!products) return <ActivityIndicator style={styles.loading} />;

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text style={styles.summary}>
            {t("webstore.summary", { count: status.inFeed, stock: status.inFeedInStock })}
          </Text>
          {status.belowMinimum ? (
            <Banner
              tone="warn"
              text={t("webstore.warnBelow", { min: status.min, count: status.inFeed })}
            />
          ) : null}
          {status.excluded.length > 0 ? (
            <Banner
              tone="info"
              text={t("webstore.excludedBanner", {
                names: status.excluded.map((p) => isolateBidi(displayName(p))).join(", "),
              })}
            />
          ) : null}
          <BigButton label={t("webstore.add")} onPress={() => router.push("/(app)/webstore/new")} />
          <TextInput
            style={styles.search}
            value={term}
            onChangeText={setTerm}
            placeholder={t("webstore.search")}
            accessibilityLabel={t("webstore.search")}
            placeholderTextColor={colors.ink600}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <View style={styles.chips}>
            {WEB_FILTERS.map((key) => (
              <Chip
                key={key}
                label={t(FILTER_KEY[key])}
                selected={filter === key}
                onPress={() => setFilter(key)}
              />
            ))}
          </View>
        </View>
        {products.length === 0 ? (
          <EmptyState
            icon="package"
            title={t("webstore.emptyTitle")}
            message={t("webstore.emptyHint")}
          />
        ) : shown.length === 0 ? (
          <Text style={styles.none}>{t("webstore.noMatch")}</Text>
        ) : (
          <View>
            {shown.map((product) => (
              <WebProductRow
                key={product.id}
                product={product}
                busy={busyIds.has(product.id)}
                onOpen={() => router.push(`/(app)/webstore/${product.id}`)}
                onTogglePublished={(value) => void togglePublished(product, value)}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  loading: { marginTop: 40 },
  content: { paddingBottom: 32 },
  header: { padding: 12, gap: 12 },
  summary: { fontSize: 18, fontWeight: "700", color: colors.ink900 },
  search: {
    minHeight: 52,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.ink400,
    paddingHorizontal: 16,
    fontSize: 16,
    backgroundColor: colors.white,
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  none: { padding: 16, fontSize: 15, color: colors.ink600 },
});
