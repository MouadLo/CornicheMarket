import { router, useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, View } from "react-native";
import { useTranslation } from "react-i18next";

import { BigButton } from "@/src/components/BigButton";
import { Banner } from "@/src/components/ui/Banner";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { LoadError } from "@/src/components/ui/LoadError";
import { statusLine } from "@/src/components/webstore/kitText";
import { showToast } from "@/src/lib/dialog/store";
import { errorKey } from "@/src/lib/errors/userMessage";
import { formatMAD } from "@/src/lib/money";
import { isolateBidi, keepNumberLtr } from "@/src/lib/text/bidi";
import { fetchKits, setKitPublished } from "@/src/lib/webstore/kitQueries";
import {
  FEED_KIT_LIMIT,
  kitDisplayName,
  kitStatuses,
  publishedKitCount,
} from "@/src/lib/webstore/kits";
import { fetchWebProducts } from "@/src/lib/webstore/queries";
import type { WebKit, WebProduct } from "@/src/lib/webstore/types";
import { Text } from "@/src/theme/Text";
import { colors, touch } from "@/src/theme/tokens";

// The "Kits" tab: every kit with its price (computed the way the page does),
// whether the page shows it and, when not, why. The publish switch saves at once.
export function KitsTab() {
  const { t } = useTranslation();
  const [kits, setKits] = useState<WebKit[] | null>(null);
  const [products, setProducts] = useState<WebProduct[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set());

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [list, webProducts] = await Promise.all([fetchKits(), fetchWebProducts()]);
      setKits(list);
      setProducts(webProducts);
    } catch (failure) {
      setLoadError(errorKey(failure));
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const statuses = useMemo(() => kitStatuses(kits ?? [], products), [kits, products]);

  const setBusy = (id: string, on: boolean) =>
    setBusyIds((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const patchLocal = (id: string, published: boolean) =>
    setKits((list) => list && list.map((k) => (k.id === id ? { ...k, published } : k)));

  const togglePublished = async (kit: WebKit, published: boolean) => {
    if (busyIds.has(kit.id)) return;
    setBusy(kit.id, true);
    patchLocal(kit.id, published);
    try {
      await setKitPublished(kit.id, published);
    } catch {
      patchLocal(kit.id, !published);
      showToast({ text: t("webstore.kits.publishError"), tone: "info" });
    } finally {
      setBusy(kit.id, false);
    }
  };

  if (loadError && !kits) {
    return (
      <LoadError
        title={t("webstore.kits.loadError")}
        reasonKey={loadError}
        onRetry={() => void load()}
      />
    );
  }
  if (!kits) return <ActivityIndicator style={styles.loading} />;

  const published = publishedKitCount(kits);

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.header}>
        {published > FEED_KIT_LIMIT ? (
          <Banner
            tone="warn"
            text={t("webstore.kits.warnLimit", { max: FEED_KIT_LIMIT, count: published })}
          />
        ) : null}
        <BigButton
          label={t("webstore.kits.add")}
          onPress={() => router.push("/(app)/webstore/kit/new")}
        />
      </View>
      {kits.length === 0 ? (
        <EmptyState
          icon="package"
          title={t("webstore.kits.emptyTitle")}
          message={t("webstore.kits.emptyHint")}
        />
      ) : (
        kits.map((kit) => {
          const status = statuses.get(kit.id);
          const name = kitDisplayName(kit);
          return (
            <View key={kit.id} style={styles.row}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={name}
                onPress={() => router.push(`/(app)/webstore/kit/${kit.id}`)}
                style={({ pressed }) => [styles.main, pressed && styles.pressed]}
              >
                <Text style={styles.title} numberOfLines={1}>
                  {isolateBidi(name)}
                </Text>
                <Text style={styles.meta}>
                  {t("webstore.kits.itemCount", { count: kit.items.length })}
                  {" · "}
                  {status?.priceCents == null
                    ? t("webstore.kits.priceIncomplete")
                    : keepNumberLtr(formatMAD(status.priceCents))}
                </Text>
                {status ? (
                  <Text style={status.shownOnSite ? styles.ok : styles.warn}>
                    {statusLine(t, status, byId)}
                  </Text>
                ) : null}
              </Pressable>
              <Switch
                value={kit.published}
                onValueChange={(value) => void togglePublished(kit, value)}
                disabled={busyIds.has(kit.id)}
                accessibilityLabel={t("webstore.kits.publishA11y", { name })}
                trackColor={{ true: colors.brand700, false: colors.border }}
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
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    minHeight: touch.lg,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  main: { flex: 1, gap: 3 },
  pressed: { opacity: 0.7 },
  title: { fontSize: 16, fontWeight: "600", color: colors.ink900 },
  meta: { fontSize: 15, color: colors.ink700 },
  ok: { fontSize: 14, color: colors.success700 },
  warn: { fontSize: 14, color: colors.warning700 },
});
