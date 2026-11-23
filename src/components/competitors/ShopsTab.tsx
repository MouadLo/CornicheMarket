import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Linking, ScrollView, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { BigButton } from "@/src/components/BigButton";
import { CardAction } from "@/src/components/competitors/CatalogCard";
import { agoText } from "@/src/components/competitors/CompetitorSection";
import { Banner } from "@/src/components/ui/Banner";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { Field } from "@/src/components/ui/Field";
import { LoadError } from "@/src/components/ui/LoadError";
import { StatusPill } from "@/src/components/ui/StatusPill";
import { shopReason, type ShopRow } from "@/src/lib/competitors/catalog";
import {
  addShop,
  deleteShop,
  fetchShops,
  readShopNow,
  rematch,
  type ReadResult,
} from "@/src/lib/competitors/shops";
import { confirmDestructive } from "@/src/lib/confirmDestructive";
import { showToast } from "@/src/lib/dialog/store";
import { errorKey } from "@/src/lib/errors/userMessage";
import { isolateLtr } from "@/src/lib/text/bidi";
import { Text } from "@/src/theme/Text";
import { colors } from "@/src/theme/tokens";

// Owner only. The shops we read: add one by its address, read it now, see why a
// read was refused, recompute the proposals, delete a shop.
export function ShopsTab({ onChanged }: { onChanged: () => void }) {
  const { t } = useTranslation();
  const [shops, setShops] = useState<ShopRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [recalculating, setRecalculating] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setShops(await fetchShops());
    } catch (failure) {
      setLoadError(errorKey(failure));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const changed = async () => {
    await load();
    onChanged();
  };

  const add = async () => {
    setAddError(null);
    if (!url.trim()) {
      setAddError(t("competitors.shopReason.invalid_url"));
      return;
    }
    setAdding(true);
    try {
      const result = await addShop(url.trim(), name);
      if (result.status === "rejected") {
        setAddError(t(shopReason(result.reason)));
      } else {
        setUrl("");
        setName("");
        let read: ReadResult | undefined = result.read;
        // A read that ran out of time continues until the catalogue is complete.
        if (read?.status === "syncing") read = await readShopNow(result.shopId);
        showToast({
          text:
            read?.status === "ok"
              ? t("competitors.shops.readDone", { count: isolateLtr(String(read.items)) })
              : t("competitors.shops.added"),
          tone: "success",
        });
      }
      await changed();
    } catch (failure) {
      setAddError(t(errorKey(failure)));
    } finally {
      setAdding(false);
    }
  };

  const recalc = async () => {
    setRecalculating(true);
    try {
      const count = await rematch();
      showToast({
        text: t("competitors.shops.recalcDone", { count: isolateLtr(String(count)) }),
        tone: "success",
      });
      onChanged();
    } catch {
      showToast({ text: t("competitors.shops.recalcError"), tone: "info" });
    } finally {
      setRecalculating(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.hint}>{t("competitors.shops.hint")}</Text>

      <View style={styles.card}>
        <Text style={styles.title}>{t("competitors.shops.addTitle")}</Text>
        <Field
          label={t("competitors.shops.urlLabel")}
          placeholder={t("competitors.shops.urlPlaceholder")}
          value={url}
          onChangeText={setUrl}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />
        <Field
          label={t("competitors.shops.nameLabel")}
          placeholder={t("competitors.shops.namePlaceholder")}
          value={name}
          onChangeText={setName}
          maxLength={60}
        />
        {addError ? <Banner tone="warn" text={addError} /> : null}
        <BigButton
          label={adding ? t("competitors.shops.adding") : t("competitors.shops.add")}
          onPress={() => void add()}
          disabled={adding}
        />
      </View>

      {loadError ? (
        <LoadError
          title={t("competitors.catalog.loadError")}
          reasonKey={loadError}
          onRetry={() => void load()}
        />
      ) : shops === null ? (
        <ActivityIndicator />
      ) : shops.length === 0 ? (
        <EmptyState
          icon="package"
          title={t("competitors.shops.emptyTitle")}
          message={t("competitors.shops.emptyHint")}
        />
      ) : (
        <>
          {shops.map((shop) => (
            <ShopCard key={shop.id} shop={shop} onChanged={changed} />
          ))}
          <BigButton
            label={recalculating ? t("competitors.shops.reading") : t("competitors.shops.recalc")}
            variant="secondary"
            onPress={() => void recalc()}
            disabled={recalculating}
          />
        </>
      )}
    </ScrollView>
  );
}

function ShopCard({ shop, onChanged }: { shop: ShopRow; onChanged: () => Promise<void> }) {
  const { t } = useTranslation();
  const [reading, setReading] = useState(false);
  const [page, setPage] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const ago = agoText(shop.last_sync_completed_at, t);
  const tone =
    shop.status === "ok"
      ? "ok"
      : shop.status === "syncing"
        ? "info"
        : shop.status === "refused"
          ? "warn"
          : "bad";
  const icon = shop.status === "ok" ? "check" : shop.status === "syncing" ? "refresh" : "alert";

  const describe = (result: ReadResult): string | null => {
    switch (result.status) {
      case "ok":
        return t("competitors.shops.readDone", { count: isolateLtr(String(result.items)) });
      case "rate_limited": {
        const minutes = Math.max(1, Math.ceil((result.retryAfterSeconds ?? 3600) / 60));
        return t("competitors.shops.tooSoon", { minutes: isolateLtr(String(minutes)) });
      }
      case "busy":
        return t("competitors.shops.busy");
      case "syncing":
        return t("competitors.shops.progress", { page: isolateLtr(String(result.nextPage)) });
      case "refused":
      case "currency_not_mad":
      case "not_woocommerce":
        return t(shopReason(result.status === "refused" ? result.detail : result.status));
      default:
        return t("competitors.shops.readFailed");
    }
  };

  const read = async () => {
    setReading(true);
    setMessage(null);
    try {
      const result = await readShopNow(shop.id, (next) => setPage(next));
      setMessage(describe(result));
      await onChanged();
    } catch (failure) {
      setMessage(t(errorKey(failure)));
    } finally {
      setReading(false);
      setPage(null);
    }
  };

  const remove = async () => {
    const ok = await confirmDestructive(
      t("competitors.shops.deleteTitle"),
      t("competitors.shops.deleteMessage", { shop: shop.name }),
      t("competitors.shops.delete"),
      t("common.cancel")
    );
    if (!ok) return;
    try {
      await deleteShop(shop.id);
      await onChanged();
    } catch (failure) {
      setMessage(t(errorKey(failure)));
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <Text style={styles.title}>{shop.name}</Text>
        <StatusPill label={t(`competitors.shops.status.${shop.status}`)} tone={tone} icon={icon} />
      </View>
      <Text style={styles.hint}>{shop.base_url}</Text>
      <Text style={styles.hint}>
        {t("competitors.shops.items", { count: isolateLtr(String(shop.items_count)) })}
        {" · "}
        {ago ? t("competitors.shops.lastRead", { ago }) : t("competitors.shops.neverRead")}
      </Text>
      <Text style={styles.hint}>
        {t("competitors.shops.counts", {
          proposed: isolateLtr(String(shop.proposed_count)),
          missing: isolateLtr(String(shop.missing_count)),
          wanted: isolateLtr(String(shop.wanted_count)),
        })}
      </Text>
      {shop.status === "refused" || shop.status === "error" ? (
        <Banner tone="warn" text={t(shopReason(shop.status_detail))} />
      ) : null}
      {reading && page !== null ? (
        <Text style={styles.hint}>
          {t("competitors.shops.progress", { page: isolateLtr(String(page)) })}
        </Text>
      ) : null}
      {message ? <Text style={styles.hint}>{message}</Text> : null}
      <View style={styles.row}>
        <CardAction
          primary
          label={reading ? t("competitors.shops.reading") : t("competitors.shops.readNow")}
          onPress={() => void read()}
          disabled={reading}
        />
        <CardAction
          label={t("competitors.shops.open")}
          onPress={() => void Linking.openURL(shop.base_url)}
        />
        <CardAction danger label={t("competitors.shops.delete")} onPress={() => void remove()} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 12, gap: 12, paddingBottom: 40 },
  hint: { fontSize: 13, color: colors.ink600, lineHeight: 18 },
  title: { fontSize: 16, fontWeight: "700", color: colors.ink900, flexShrink: 1 },
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  card: {
    gap: 8,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
});
