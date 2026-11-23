import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Linking,
  Pressable,
  StyleSheet,
  Switch,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";

import { BigButton } from "@/src/components/BigButton";
import { PhotoDownload } from "@/src/components/competitors/CatalogCard";
import { Banner } from "@/src/components/ui/Banner";
import { Field } from "@/src/components/ui/Field";
import { InlineError } from "@/src/components/ui/InlineError";
import { Money } from "@/src/components/ui/Money";
import { StatusPill } from "@/src/components/ui/StatusPill";
import { useAuth } from "@/src/lib/auth/AuthProvider";
import { freshness, reasonKey, validateLinkInput } from "@/src/lib/competitors/link";
import type { OverviewRow } from "@/src/lib/competitors/overview";
import {
  addCompetitorLink,
  checkCompetitorLink,
  fetchCompetitorRows,
  fetchProductMarginFloor,
  removeCompetitorLink,
  saveManualPrice,
  setProductMarginFloor,
} from "@/src/lib/competitors/queries";
import type { CheckResult } from "@/src/lib/competitors/types";
import { confirmDestructive } from "@/src/lib/confirmDestructive";
import { showToast } from "@/src/lib/dialog/store";
import { errorKey } from "@/src/lib/errors/userMessage";
import { centsToDisplay, formatMAD, parseMoneyToCents } from "@/src/lib/money";
import { parseMarginPercent } from "@/src/lib/sellGrid/diversSettings";
import { isolateLtr } from "@/src/lib/text/bidi";
import { Text } from "@/src/theme/Text";
import { colors, radius } from "@/src/theme/tokens";

type Translate = (key: string, values?: Record<string, unknown>) => string;

export function agoText(iso: string | null, t: Translate, now = Date.now()): string | null {
  const ago = freshness(iso, now);
  if (!ago) return null;
  const key = ago.unit === "minutes" ? "agoMinutes" : ago.unit === "hours" ? "agoHours" : "agoDays";
  return t(`competitors.${key}`, { count: isolateLtr(String(ago.count)) });
}

// Owner only: renders nothing for anyone else (and the database refuses a
// cashier's session anyway).
export function CompetitorSection({
  productId,
  onChanged,
}: {
  productId: string;
  // Called after a link was added, checked, edited or removed, or the margin
  // floor saved, so a page showing the decision can refresh it.
  onChanged?: () => void;
}) {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const isOwner = profile?.role === "owner";
  const [rows, setRows] = useState<OverviewRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setRows(await fetchCompetitorRows(productId));
    } catch (failure) {
      setLoadError(errorKey(failure));
    }
  }, [productId]);

  useEffect(() => {
    if (isOwner) void load();
  }, [isOwner, load]);

  const changed = async () => {
    await load();
    onChanged?.();
  };

  if (!isOwner) return null;

  return (
    <View style={styles.section}>
      <Text style={styles.title}>{t("competitors.sectionTitle")}</Text>
      <Text style={styles.hint}>{t("competitors.sectionHint")}</Text>
      {loadError ? (
        <>
          <InlineError reasonKey={loadError} />
          <BigButton label={t("common.retry")} variant="secondary" onPress={() => void load()} />
        </>
      ) : rows === null ? (
        <ActivityIndicator />
      ) : rows.length === 0 ? (
        <Text style={styles.hint}>{t("competitors.empty")}</Text>
      ) : (
        rows.map((row) => <LinkCard key={row.link_id} row={row} onChanged={changed} />)
      )}
      <AddLinkForm productId={productId} onAdded={changed} />
      <MarginOverride productId={productId} onSaved={onChanged} />
    </View>
  );
}

function LinkCard({ row, onChanged }: { row: OverviewRow; onChanged: () => Promise<void> }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [priceText, setPriceText] = useState(
    row.price_cents !== null ? centsToDisplay(row.price_cents) : ""
  );
  const [soldOut, setSoldOut] = useState(row.in_stock === false);

  const isManual = row.mode === "manual";
  const read = row.observed_at !== null;
  const ago = agoText(row.last_checked_at, t);
  // Sites that refuse, or that cannot be read at all, stay manual; a retry only
  // makes sense for a failure that may pass.
  const canRetry =
    isManual &&
    row.last_status_detail !== "app_only_site" &&
    row.last_status_detail !== "invalid_url";
  const failed =
    row.last_status === "refused" ||
    row.last_status === "unsupported" ||
    row.last_status === "error";

  const run = async (retry: boolean) => {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const result = await checkCompetitorLink(row.link_id, retry);
      if (result.status === "rate_limited") {
        const minutes = Math.max(1, Math.ceil((result.retryAfterSeconds ?? 600) / 60));
        setMessage(t("competitors.tooSoon", { minutes: isolateLtr(String(minutes)) }));
      } else if (result.status === "error") {
        setMessage(t("competitors.checkFailed"));
      }
      await onChanged();
    } catch (failure) {
      setError(errorKey(failure));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    const ok = await confirmDestructive(
      t("competitors.removeTitle"),
      t("competitors.removeMessage", { shop: row.shop_name }),
      t("competitors.remove"),
      t("common.cancel")
    );
    if (!ok) return;
    try {
      await removeCompetitorLink(row.link_id);
      await onChanged();
    } catch (failure) {
      setError(errorKey(failure));
    }
  };

  const saveManual = async () => {
    setMessage(null);
    setError(null);
    const trimmed = priceText.trim();
    const cents = trimmed === "" ? null : parseMoneyToCents(trimmed);
    if ((trimmed !== "" && cents === null) || (cents === null && !soldOut) || cents === 0) {
      setError("competitors.manualPriceInvalid");
      return;
    }
    setBusy(true);
    try {
      await saveManualPrice(row.link_id, { priceCents: cents, inStock: !soldOut });
      setMessage(t("competitors.manualSaved"));
      await onChanged();
    } catch (failure) {
      setError(errorKey(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        {row.image_url ? (
          <Image
            source={{ uri: row.image_url }}
            style={styles.photo}
            accessibilityIgnoresInvertColors
          />
        ) : null}
        <View style={styles.flex}>
          <Text style={styles.shop}>{row.shop_name}</Text>
          {row.title ? <Text style={styles.found}>{row.title}</Text> : null}
          {!read ? (
            <Text style={styles.hint}>{t("competitors.neverRead")}</Text>
          ) : row.price_cents !== null ? (
            <View style={styles.priceRow}>
              <Money cents={row.price_cents} size="body" />
              {row.on_sale ? (
                <StatusPill label={t("competitors.promo")} tone="warn" icon="tag" />
              ) : null}
            </View>
          ) : (
            <Text style={styles.hint}>{t("competitors.noPrice")}</Text>
          )}
          {read && row.on_sale && row.regular_price_cents !== null ? (
            <Text style={styles.hint}>
              {t("competitors.regularPrice", {
                price: isolateLtr(formatMAD(row.regular_price_cents)),
              })}
            </Text>
          ) : null}
        </View>
      </View>

      <View style={styles.pills}>
        {read ? (
          <StatusPill
            label={t(row.in_stock ? "competitors.inStock" : "competitors.outOfStock")}
            tone={row.in_stock ? "ok" : "bad"}
            icon={row.in_stock ? "check" : "x"}
          />
        ) : null}
        <StatusPill
          label={t(isManual ? "competitors.modeManual" : "competitors.modeAuto")}
          tone={isManual ? "neutral" : "info"}
          icon={isManual ? "pencil" : "refresh"}
        />
      </View>
      {row.low_stock_remaining !== null ? (
        <Text style={styles.hint}>
          {t("competitors.lowStock", { count: isolateLtr(String(row.low_stock_remaining)) })}
        </Text>
      ) : null}
      {ago ? <Text style={styles.hint}>{t("competitors.checked", { ago })}</Text> : null}
      {failed ? (
        <Banner
          tone="warn"
          text={`${t(
            row.last_status === "refused"
              ? "competitors.statusRefused"
              : row.last_status === "unsupported"
                ? "competitors.statusUnsupported"
                : "competitors.statusError"
          )} ${t(reasonKey(row.last_status_detail))}`}
        />
      ) : row.last_status_detail === "app_only_site" ? (
        <Banner tone="info" text={t(reasonKey(row.last_status_detail))} />
      ) : null}

      {isManual ? (
        <View style={styles.manual}>
          <Field
            label={t("competitors.manualPriceLabel")}
            unit="DH"
            numeric
            value={priceText}
            onChangeText={setPriceText}
          />
          <View style={styles.switchRow}>
            <Text style={[styles.flex, styles.label]}>{t("competitors.manualOutOfStock")}</Text>
            <Switch
              value={soldOut}
              onValueChange={setSoldOut}
              accessibilityLabel={t("competitors.manualOutOfStock")}
            />
          </View>
          <BigButton label={t("competitors.manualSave")} onPress={saveManual} disabled={busy} />
        </View>
      ) : null}

      {error ? <InlineError reasonKey={error} /> : null}
      {message ? <Text style={styles.success}>{message}</Text> : null}

      <View style={styles.actions}>
        {!isManual ? (
          <LinkAction
            label={busy ? t("competitors.checking") : t("competitors.check")}
            onPress={() => void run(false)}
            disabled={busy}
          />
        ) : canRetry ? (
          <LinkAction
            label={t("competitors.retryAuto")}
            onPress={() => void run(true)}
            disabled={busy}
          />
        ) : null}
        <LinkAction label={t("competitors.open")} onPress={() => void Linking.openURL(row.url)} />
        {row.image_url ? (
          <PhotoDownload imageUrl={row.image_url} name={row.title ?? row.product_name} />
        ) : null}
        <LinkAction label={t("competitors.remove")} onPress={() => void remove()} danger />
      </View>
    </View>
  );
}

function LinkAction({
  label,
  onPress,
  disabled,
  danger,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={styles.action}
    >
      <Text
        style={[styles.actionText, danger && styles.actionDanger, disabled && styles.actionOff]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function AddLinkForm({ productId, onAdded }: { productId: string; onAdded: () => Promise<void> }) {
  const { t } = useTranslation();
  const [shop, setShop] = useState("");
  const [link, setLink] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ shopName?: string; url?: string }>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [found, setFound] = useState<{ shop: string; check: CheckResult } | null>(null);

  const add = async () => {
    setError(null);
    setFound(null);
    const checked = validateLinkInput(shop, link);
    if (!checked.ok) {
      setFieldErrors({
        [checked.field]: t(checked.field === "url" ? "competitors.errUrl" : "competitors.errShop"),
      });
      return;
    }
    setFieldErrors({});
    setBusy(true);
    try {
      const result = await addCompetitorLink(productId, checked.shopName, checked.url);
      setFound({ shop: checked.shopName, check: result.check });
      setShop("");
      setLink("");
      await onAdded();
    } catch (failure) {
      setError(errorKey(failure));
    } finally {
      setBusy(false);
    }
  };

  const check = found?.check;
  return (
    <View style={styles.card}>
      <Text style={styles.subtitle}>{t("competitors.addTitle")}</Text>
      <Field
        label={t("competitors.shopLabel")}
        placeholder={t("competitors.shopPlaceholder")}
        value={shop}
        onChangeText={setShop}
        error={fieldErrors.shopName}
        maxLength={60}
      />
      <Field
        label={t("competitors.urlLabel")}
        placeholder={t("competitors.urlPlaceholder")}
        value={link}
        onChangeText={setLink}
        error={fieldErrors.url}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
      />
      {error ? <InlineError reasonKey={error} /> : null}
      <BigButton
        label={busy ? t("competitors.checking") : t("competitors.add")}
        onPress={add}
        disabled={busy}
      />
      {check ? (
        check.status === "ok" ? (
          <Banner
            tone="ok"
            text={`${t("competitors.found", {
              title: check.reading?.title ?? found?.shop ?? "",
            })} ${t("competitors.foundConfirm")}`}
          />
        ) : check.status === "error" || check.status === "rate_limited" ? (
          <Banner tone="info" text={t("competitors.foundLater")} />
        ) : (
          <Banner
            tone="info"
            text={`${t("competitors.foundManual")} ${t(reasonKey(check.detail ?? null))}`}
          />
        )
      ) : null}
    </View>
  );
}

function MarginOverride({ productId, onSaved }: { productId: string; onSaved?: () => void }) {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const [storePercent, setStorePercent] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | undefined>();

  useEffect(() => {
    let live = true;
    fetchProductMarginFloor(productId)
      .then((floor) => {
        if (!live) return;
        setText(floor.override === null ? "" : String(floor.override));
        setStorePercent(floor.storePercent);
        setLoaded(true);
      })
      .catch((failure) => {
        if (live) {
          setError(errorKey(failure));
          setLoaded(true);
        }
      });
    return () => {
      live = false;
    };
  }, [productId]);

  const save = async () => {
    setError(null);
    setFieldError(undefined);
    const trimmed = text.trim();
    const percent = trimmed === "" ? null : parseMarginPercent(trimmed);
    if (trimmed !== "" && percent === null) {
      setFieldError(t("competitors.marginInvalid"));
      return;
    }
    setBusy(true);
    try {
      await setProductMarginFloor(productId, percent);
      showToast({ text: t("competitors.marginSaved"), tone: "success" });
      onSaved?.();
    } catch (failure) {
      setError(errorKey(failure));
    } finally {
      setBusy(false);
    }
  };

  if (!loaded) return null;
  return (
    <View style={styles.card}>
      <Text style={styles.subtitle}>{t("competitors.marginTitle")}</Text>
      <Field
        label={t("competitors.marginLabel")}
        unit="%"
        numeric
        value={text}
        onChangeText={setText}
        helper={
          storePercent === null
            ? undefined
            : t("competitors.marginHint", { percent: isolateLtr(String(storePercent)) })
        }
        error={fieldError}
      />
      {error ? <InlineError reasonKey={error} /> : null}
      <BigButton
        label={t("competitors.marginSave")}
        variant="secondary"
        onPress={save}
        disabled={busy}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 12, marginTop: 24 },
  title: { fontSize: 20, fontWeight: "700", color: colors.ink900 },
  subtitle: { fontSize: 16, fontWeight: "600", color: colors.ink900 },
  hint: { fontSize: 13, color: colors.ink600, lineHeight: 18 },
  flex: { flex: 1 },
  card: {
    gap: 8,
    padding: 12,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  cardTop: { flexDirection: "row", gap: 12 },
  photo: { width: 56, height: 56, borderRadius: 8, backgroundColor: colors.sunken },
  shop: { fontSize: 16, fontWeight: "700", color: colors.ink900 },
  found: { fontSize: 14, color: colors.ink700 },
  priceRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  pills: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  manual: { gap: 8 },
  switchRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  label: { fontSize: 15, color: colors.ink900 },
  success: { color: colors.success700 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  action: { minHeight: 44, justifyContent: "center", paddingEnd: 16 },
  actionText: { color: colors.brand600, fontSize: 15, fontWeight: "600" },
  actionDanger: { color: colors.danger700 },
  actionOff: { color: colors.ink400 },
});
