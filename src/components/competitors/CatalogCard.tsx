import { useState, type ReactNode } from "react";
import { Image, Linking, Pressable, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { Money } from "@/src/components/ui/Money";
import { StatusPill } from "@/src/components/ui/StatusPill";
import { discountPercent, type CatalogRow } from "@/src/lib/competitors/catalog";
import { downloadCompetitorImage } from "@/src/lib/competitors/imageDownload";
import { confirm, showToast } from "@/src/lib/dialog/store";
import { copyCompetitorPhoto, fetchProductPhotoPath } from "@/src/lib/products/photos";
import { formatMAD } from "@/src/lib/money";
import { isolateLtr } from "@/src/lib/text/bidi";
import { Text } from "@/src/theme/Text";
import { colors } from "@/src/theme/tokens";

// A small text button of a card (same look as the phase 1 link cards).
export function CardAction({
  label,
  onPress,
  disabled,
  danger,
  primary,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  danger?: boolean;
  primary?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={styles.action}
    >
      <Text
        style={[
          styles.actionText,
          primary && styles.actionPrimary,
          danger && styles.actionDanger,
          disabled && styles.actionOff,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

// "Télécharger la photo", wherever a competitor photo is shown.
export function PhotoDownload({ imageUrl, name }: { imageUrl: string; name: string }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const result = await downloadCompetitorImage(imageUrl, name);
      showToast({
        text: t(
          result === "saved"
            ? "competitors.catalog.photoSaved"
            : result === "refused"
              ? "competitors.catalog.photoRefused"
              : "competitors.catalog.photoError"
        ),
        tone: result === "saved" ? "success" : "info",
      });
    } catch {
      showToast({ text: t("competitors.catalog.photoError"), tone: "info" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <CardAction
      label={t(busy ? "competitors.catalog.downloading" : "competitors.catalog.downloadPhoto")}
      onPress={() => void run()}
      disabled={busy}
    />
  );
}

// "Utiliser cette photo": copies the competitor's photo to OUR product (stored in
// our own bucket, never linked to their site). Owner only (the edge function
// refuses anyone else). Asks first when the product already has a photo.
export function UsePhoto({ imageUrl, productId }: { imageUrl: string; productId: string }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const existing = await fetchProductPhotoPath(productId).catch(() => null);
      if (existing) {
        const ok = await confirm({
          title: t("competitors.catalog.usePhotoReplaceTitle"),
          message: t("competitors.catalog.usePhotoReplaceMessage"),
          confirmLabel: t("competitors.catalog.usePhotoReplace"),
          cancelLabel: t("common.cancel"),
        });
        if (!ok) return;
      }
      const result = await copyCompetitorPhoto(imageUrl, productId);
      showToast({
        text: t(
          result === "saved"
            ? "competitors.catalog.usePhotoDone"
            : result === "refused"
              ? "competitors.catalog.photoRefused"
              : "competitors.catalog.usePhotoError"
        ),
        tone: result === "saved" ? "success" : "info",
      });
    } catch {
      showToast({ text: t("competitors.catalog.usePhotoError"), tone: "info" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <CardAction
      label={t(busy ? "competitors.catalog.usingPhoto" : "competitors.catalog.usePhoto")}
      onPress={() => void run()}
      disabled={busy}
    />
  );
}

// One product of a competitor shop: photo, name, price (promo / regular), stock,
// category, shop, link. `children` holds the actions of the screen.
export function CatalogCard({
  row,
  children,
  header,
}: {
  row: CatalogRow;
  header?: ReactNode;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const percent = discountPercent(row.price_cents, row.regular_price_cents);
  return (
    <View style={styles.card}>
      {header}
      <View style={styles.top}>
        {row.image_url ? (
          <Image
            source={{ uri: row.image_url }}
            style={styles.photo}
            accessibilityIgnoresInvertColors
          />
        ) : (
          <View style={[styles.photo, styles.noPhoto]}>
            <Text style={styles.hint}>{t("competitors.catalog.noPhoto")}</Text>
          </View>
        )}
        <View style={styles.flex}>
          <Text style={styles.name}>{row.name}</Text>
          {row.price_cents !== null ? (
            <View style={styles.priceRow}>
              <Money cents={row.price_cents} size="body" />
              {row.on_sale && percent !== null ? (
                <StatusPill
                  label={t("competitors.catalog.promoOff", {
                    percent: isolateLtr(String(percent)),
                  })}
                  tone="warn"
                  icon="tag"
                />
              ) : null}
            </View>
          ) : (
            <Text style={styles.hint}>{t("competitors.noPrice")}</Text>
          )}
          {row.on_sale && row.regular_price_cents !== null ? (
            <Text style={styles.hint}>
              {t("competitors.regularPrice", {
                price: isolateLtr(formatMAD(row.regular_price_cents)),
              })}
            </Text>
          ) : null}
          <Text style={styles.hint}>
            {t("competitors.catalog.inShop", { shop: row.shop_name })}
            {row.popularity_rank !== null
              ? ` · ${t("competitors.catalog.rank", { rank: isolateLtr(String(row.popularity_rank)) })}`
              : ""}
          </Text>
          {row.categories.length > 0 ? (
            <Text style={styles.hint}>
              {t("competitors.catalog.category", { category: row.categories[0] })}
            </Text>
          ) : null}
        </View>
      </View>
      <View style={styles.pills}>
        <StatusPill
          label={t(row.in_stock ? "competitors.inStock" : "competitors.outOfStock")}
          tone={row.in_stock ? "ok" : "bad"}
          icon={row.in_stock ? "check" : "x"}
        />
        {row.low_stock_remaining !== null ? (
          <Text style={styles.hint}>
            {t("competitors.lowStock", { count: isolateLtr(String(row.low_stock_remaining)) })}
          </Text>
        ) : null}
      </View>
      <View style={styles.actions}>
        {children}
        <CardAction label={t("competitors.open")} onPress={() => void Linking.openURL(row.url)} />
        {row.image_url ? <PhotoDownload imageUrl={row.image_url} name={row.name} /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: 10,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  top: { flexDirection: "row", gap: 12 },
  flex: { flex: 1, gap: 2 },
  photo: { width: 80, height: 80, borderRadius: 8, backgroundColor: colors.sunken },
  noPhoto: { alignItems: "center", justifyContent: "center" },
  name: { fontSize: 16, fontWeight: "700", color: colors.ink900 },
  priceRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  hint: { fontSize: 13, color: colors.ink600, lineHeight: 18 },
  pills: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  action: { minHeight: 44, paddingHorizontal: 8, justifyContent: "center" },
  actionText: { fontSize: 15, fontWeight: "600", color: colors.brand700 },
  actionPrimary: { color: colors.brand800, fontWeight: "700" },
  actionDanger: { color: colors.danger700 },
  actionOff: { color: colors.ink600 },
});
