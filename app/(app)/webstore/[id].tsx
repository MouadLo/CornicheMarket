import { Redirect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";

import { BigButton } from "@/src/components/BigButton";
import { Card } from "@/src/components/ui/Card";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { Field } from "@/src/components/ui/Field";
import { InlineError } from "@/src/components/ui/InlineError";
import { LoadError } from "@/src/components/ui/LoadError";
import { Segmented } from "@/src/components/ui/Segmented";
import { ChoiceChips } from "@/src/components/webstore/ChoiceChips";
import { LinkSection } from "@/src/components/webstore/LinkSection";
import { SwitchRow } from "@/src/components/webstore/SwitchRow";
import { WebPhotoSection } from "@/src/components/webstore/WebPhotoSection";
import { useAuth } from "@/src/lib/auth/AuthProvider";
import { confirmDestructive } from "@/src/lib/confirmDestructive";
import { showToast } from "@/src/lib/dialog/store";
import { errorKey } from "@/src/lib/errors/userMessage";
import { centsToDisplay, formatMAD } from "@/src/lib/money";
import { useLeaveScreen } from "@/src/lib/nav/useLeaveScreen";
import { useUnsavedGuard } from "@/src/lib/products/useUnsavedGuard";
import { isolateBidi, keepNumberLtr } from "@/src/lib/text/bidi";
import {
  isValidImageUrl,
  validateForm,
  type FormErrors,
  type FormValues,
} from "@/src/lib/webstore/form";
import {
  deleteWebProduct,
  fetchKitsUsing,
  fetchLinkCandidates,
  fetchWebCategories,
  fetchWebProducts,
  setPublished,
  updateWebProduct,
} from "@/src/lib/webstore/queries";
import { dropsBelowMinimum, feedStatus, resolvedPriceCents } from "@/src/lib/webstore/resolve";
import type { LinkCandidate, WebCategory, WebProduct } from "@/src/lib/webstore/types";
import { Text } from "@/src/theme/Text";
import { colors } from "@/src/theme/tokens";

function initialValues(p: WebProduct): FormValues {
  return {
    name: p.name,
    nameFr: p.name_fr ?? "",
    size: p.size ?? "",
    categoryId: p.category_id,
    subCode: p.sub_code,
    popular: p.popular,
    keywords: p.keywords ?? "",
    imageUrl: p.image_url ?? "",
    priceText: p.price_cents === null ? "" : centsToDisplay(p.price_cents),
    stockMode: p.stock_mode,
    manualInStock: p.manual_in_stock,
  };
}

// The error shown under each input, cleared when the input changes.
const FIELD_OF: Partial<Record<keyof FormValues, keyof FormErrors>> = {
  name: "name",
  nameFr: "nameFr",
  categoryId: "category",
  imageUrl: "image",
  priceText: "price",
  stockMode: "stock",
};

const price = (cents: number) => keepNumberLtr(formatMAD(cents));

// Owner only. Edits one product of the public webstore: its link to the app,
// price, stock and the page's own details. The link and the publish switch
// save at once; the rest is saved with the button.
export default function WebstoreProductEdit() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const { profile } = useAuth();
  const isOwner = profile?.role === "owner";
  const leave = useLeaveScreen();
  const setDirty = useUnsavedGuard({
    title: t("products.formUnsavedTitle"),
    message: t("products.formUnsavedMessage"),
    leave: t("products.formUnsavedLeave"),
    stay: t("products.formUnsavedStay"),
  });

  const [all, setAll] = useState<WebProduct[] | null>(null);
  const [categories, setCategories] = useState<WebCategory[]>([]);
  const [candidates, setCandidates] = useState<LinkCandidate[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [values, setValues] = useState<FormValues | null>(null);
  const [baseline, setBaseline] = useState<FormValues | null>(null);
  const [errors, setErrors] = useState<FormErrors>({});
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const product = useMemo(() => all?.find((p) => p.id === id) ?? null, [all, id]);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [list, cats, apps] = await Promise.all([
        fetchWebProducts(),
        fetchWebCategories(),
        // Suggestions are a help: without them the screen still works.
        fetchLinkCandidates().catch(() => [] as LinkCandidate[]),
      ]);
      setAll(list);
      setCategories(cats);
      setCandidates(apps);
      const found = list.find((p) => p.id === id);
      if (found) {
        const initial = initialValues(found);
        setValues(initial);
        setBaseline(initial);
      }
    } catch (failure) {
      setLoadError(errorKey(failure));
    }
  }, [id]);

  useEffect(() => {
    if (isOwner) void load();
  }, [isOwner, load]);

  // After the link changed: take the new product and what depends on the link
  // (unlinking puts the stock back on manual), keep what the owner typed.
  const reloadAfterLink = useCallback(async () => {
    const list = await fetchWebProducts();
    setAll(list);
    const found = list.find((p) => p.id === id);
    if (found) {
      // While linked the typed price is not editable: do not let it count as a change.
      const price = found.price_cents === null ? "" : centsToDisplay(found.price_cents);
      const apply = (v: FormValues): FormValues => ({
        ...v,
        stockMode: found.stock_mode,
        ...(found.product_id ? { priceText: price } : {}),
      });
      setValues((v) => (v ? apply(v) : v));
      setBaseline((b) => (b ? apply(b) : b));
    }
  }, [id]);

  const dirty = !!values && !!baseline && JSON.stringify(values) !== JSON.stringify(baseline);
  useEffect(() => {
    setDirty(dirty);
  });

  if (profile && !isOwner) return <Redirect href="/(app)/sell" />;
  if (!isOwner) return null;
  if (loadError) {
    return (
      <LoadError
        title={t("webstore.loadError")}
        reasonKey={loadError}
        onRetry={() => void load()}
      />
    );
  }
  if (!all) return <ActivityIndicator style={styles.loading} />;
  if (!product || !values) {
    return <EmptyState icon="package" title={t("webstore.notFound")} />;
  }

  const linked = product.product_id !== null;
  const set = <K extends keyof FormValues>(key: K, value: FormValues[K]) => {
    setValues((v) => (v ? { ...v, [key]: value } : v));
    const field = FIELD_OF[key];
    if (field) setErrors((e) => ({ ...e, [field]: undefined }));
  };
  const category = categories.find((c) => c.id === values.categoryId);
  const imageUrl = values.imageUrl.trim();
  const oldPrice = product.price_cents;

  const save = async () => {
    setSaveError(null);
    const { errors: found, patch } = validateForm(values, { linked, categories });
    setErrors(found);
    if (!patch) return;
    setSaving(true);
    try {
      await updateWebProduct(product.id, patch);
      setDirty(false);
      showToast({ text: t("webstore.saved"), tone: "success" });
      leave();
    } catch (failure) {
      setSaveError(errorKey(failure));
    } finally {
      setSaving(false);
    }
  };

  const togglePublished = async (published: boolean) => {
    if (publishing) return;
    if (!published && dropsBelowMinimum(all, product.id, false)) {
      const ok = await confirmDestructive(
        t("webstore.hideTitle"),
        t("webstore.hideMessage", { count: feedStatus(all).inFeed - 1, min: feedStatus(all).min }),
        t("webstore.hideConfirm"),
        t("common.cancel")
      );
      if (!ok) return;
    }
    setPublishing(true);
    const mark = (value: boolean) =>
      setAll(
        (list) => list && list.map((p) => (p.id === product.id ? { ...p, published: value } : p))
      );
    mark(published);
    try {
      await setPublished(product.id, published);
    } catch {
      mark(!published);
      showToast({ text: t("webstore.publishError"), tone: "info" });
    } finally {
      setPublishing(false);
    }
  };

  const remove = async () => {
    let kits: string[] = [];
    try {
      kits = await fetchKitsUsing(product.id);
    } catch {
      // The warning is a help: deleting still asks.
    }
    const name = (product.name_fr ?? "").trim() || product.name;
    const message =
      t("webstore.deleteMessage") +
      (kits.length > 0 ? `\n\n${t("webstore.deleteKits", { kits: kits.join(", ") })}` : "");
    const ok = await confirmDestructive(
      t("webstore.deleteTitle", { name: isolateBidi(name) }),
      message,
      t("webstore.deleteButton"),
      t("common.cancel")
    );
    if (!ok) return;
    try {
      await deleteWebProduct(product.id);
      setDirty(false);
      leave();
    } catch {
      showToast({ text: t("webstore.deleteError"), tone: "info" });
    }
  };

  const err = (key: keyof FormErrors) => (errors[key] ? t(errors[key] as string) : undefined);

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <LinkSection
        product={product}
        all={all}
        candidates={candidates}
        onChanged={reloadAfterLink}
      />

      <Card title={t("webstore.priceTitle")} style={styles.card}>
        {linked ? (
          <>
            <Text style={styles.label}>{t("webstore.priceFromApp")}</Text>
            <Text style={styles.big}>
              {resolvedPriceCents(product) === null
                ? "—"
                : price(resolvedPriceCents(product) as number)}
            </Text>
            <Text style={styles.hint}>{t("webstore.priceFromAppHint")}</Text>
            {oldPrice !== null ? (
              <Text style={styles.muted}>{t("webstore.priceOld", { price: price(oldPrice) })}</Text>
            ) : null}
          </>
        ) : (
          <Field
            label={t("webstore.priceLabel")}
            value={values.priceText}
            onChangeText={(text) => set("priceText", text)}
            numeric
            unit="DH"
            helper={t("webstore.priceHint")}
            error={err("price")}
          />
        )}
      </Card>

      <Card title={t("webstore.stockTitle")} style={styles.card}>
        <Segmented
          value={values.stockMode}
          onChange={(mode) => set("stockMode", mode)}
          options={[
            { key: "manual", label: t("webstore.stockManual") },
            { key: "auto", label: t("webstore.stockAuto"), disabled: !linked },
          ]}
        />
        {!linked ? <Text style={styles.hint}>{t("webstore.stockAutoNeedsLink")}</Text> : null}
        {values.stockMode === "manual" ? (
          <SwitchRow
            label={t("webstore.stockSwitch")}
            value={values.manualInStock}
            onValueChange={(on) => set("manualInStock", on)}
          />
        ) : (
          <Text style={styles.label}>
            {t("webstore.stockAutoLine", {
              state: t(
                (product.app?.stock_quantity ?? 0) > 0 ? "webstore.inStock" : "webstore.outOfStock"
              ),
              qty: product.app?.stock_quantity ?? 0,
            })}
          </Text>
        )}
        {err("stock") ? <Text style={styles.error}>{err("stock")}</Text> : null}
      </Card>

      <WebPhotoSection
        product={product}
        appPhotoPath={product.app?.photo_path ?? null}
        onChange={(patch) =>
          setAll((list) => list && list.map((p) => (p.id === product.id ? { ...p, ...patch } : p)))
        }
      />

      <Card title={t("webstore.sheetTitle")} style={styles.card}>
        <Field
          label={t("webstore.fName")}
          value={values.name}
          onChangeText={(text) => set("name", text)}
          error={err("name")}
        />
        <Field
          label={t("webstore.fNameFr")}
          value={values.nameFr}
          onChangeText={(text) => set("nameFr", text)}
          error={err("nameFr")}
        />
        <Field
          label={t("webstore.fSize")}
          value={values.size}
          onChangeText={(text) => set("size", text)}
        />
        <Text style={styles.label}>{t("webstore.fCategory")}</Text>
        <ChoiceChips
          options={categories.map((c) => ({ key: c.id, label: c.name_fr || c.name }))}
          value={values.categoryId}
          onChange={(key) => {
            setValues((v) => (v && key ? { ...v, categoryId: key, subCode: null } : v));
            setErrors((e) => ({ ...e, category: undefined }));
          }}
        />
        {err("category") ? <Text style={styles.error}>{err("category")}</Text> : null}
        {category && category.subs.length > 0 ? (
          <>
            <Text style={styles.label}>{t("webstore.fSub")}</Text>
            <ChoiceChips
              options={[
                { key: null, label: t("webstore.fSubNone") },
                ...category.subs.map((s) => ({ key: s.code, label: s.name_fr || s.name })),
              ]}
              value={values.subCode}
              onChange={(key) => set("subCode", key)}
            />
          </>
        ) : null}
        <SwitchRow
          label={t("webstore.fPopular")}
          value={values.popular}
          onValueChange={(on) => set("popular", on)}
        />
        <Field
          label={t("webstore.fKeywords")}
          value={values.keywords}
          onChangeText={(text) => set("keywords", text)}
          helper={t("webstore.fKeywordsHint")}
        />
        <Field
          label={t("webstore.fImage")}
          value={values.imageUrl}
          onChangeText={(text) => set("imageUrl", text)}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          error={
            err("image") ??
            (imageUrl !== "" && !isValidImageUrl(imageUrl) ? t("webstore.errImageUrl") : undefined)
          }
        />
        <SwitchRow
          label={t("webstore.publishedLabel")}
          value={product.published}
          onValueChange={(on) => void togglePublished(on)}
          disabled={publishing}
        />
      </Card>

      {saveError ? <InlineError reasonKey={saveError} /> : null}
      <BigButton
        label={saving ? t("common.saving") : t("webstore.save")}
        disabled={saving}
        onPress={() => void save()}
      />
      <BigButton
        label={t("webstore.deleteButton")}
        variant="danger"
        disabled={saving}
        onPress={() => void remove()}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  loading: { marginTop: 40 },
  content: { padding: 12, gap: 12, paddingBottom: 40 },
  card: { gap: 10 },
  label: { fontSize: 14, fontWeight: "700", color: colors.ink700 },
  big: { fontSize: 22, fontWeight: "700", color: colors.ink900 },
  hint: { fontSize: 14, color: colors.ink600, lineHeight: 20 },
  muted: { fontSize: 13, color: colors.ink600 },
  error: { fontSize: 14, color: colors.danger700 },
});
