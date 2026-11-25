import { Redirect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";

import { BigButton } from "@/src/components/BigButton";
import { Banner } from "@/src/components/ui/Banner";
import { Card } from "@/src/components/ui/Card";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { Field } from "@/src/components/ui/Field";
import { InlineError } from "@/src/components/ui/InlineError";
import { LoadError } from "@/src/components/ui/LoadError";
import { KitItemRow } from "@/src/components/webstore/KitItemRow";
import { KitProductPicker } from "@/src/components/webstore/KitProductPicker";
import { statusLine } from "@/src/components/webstore/kitText";
import { SwitchRow } from "@/src/components/webstore/SwitchRow";
import { useAuth } from "@/src/lib/auth/AuthProvider";
import { confirmDestructive } from "@/src/lib/confirmDestructive";
import { showToast } from "@/src/lib/dialog/store";
import { errorKey } from "@/src/lib/errors/userMessage";
import { formatMAD } from "@/src/lib/money";
import { useLeaveScreen } from "@/src/lib/nav/useLeaveScreen";
import { useUnsavedGuard } from "@/src/lib/products/useUnsavedGuard";
import { isolateBidi, keepNumberLtr } from "@/src/lib/text/bidi";
import {
  createKit,
  deleteKit,
  fetchKits,
  saveKitItems,
  updateKit,
} from "@/src/lib/webstore/kitQueries";
import {
  clampQty,
  FEED_KIT_ITEM_LIMIT,
  itemProblem,
  kitDisplayName,
  kitStatuses,
  newKitId,
  validateKit,
  type KitFormErrors,
} from "@/src/lib/webstore/kits";
import { fetchWebProducts } from "@/src/lib/webstore/queries";
import type { WebKit, WebProduct } from "@/src/lib/webstore/types";
import { Text } from "@/src/theme/Text";
import { colors } from "@/src/theme/tokens";

type Line = { web_product_id: string; qty: number };
type Values = { name: string; nameFr: string; published: boolean; items: Line[] };

const NEW = "new";

const fromKit = (kit: WebKit): Values => ({
  name: kit.name,
  nameFr: kit.name_fr ?? "",
  published: kit.published,
  items: kit.items.map((i) => ({ web_product_id: i.web_product_id, qty: i.qty })),
});

// Owner only. Edits one kit of the public webstore ("new" creates one): its
// names, whether it is published and its lines (product, quantity, order). The
// price shown is the one the page will compute; the status says whether the
// page will show the kit and, when not, why.
export default function WebstoreKitEdit() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === NEW;
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

  const [kits, setKits] = useState<WebKit[] | null>(null);
  const [products, setProducts] = useState<WebProduct[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [values, setValues] = useState<Values | null>(null);
  const [baseline, setBaseline] = useState<Values | null>(null);
  const [errors, setErrors] = useState<KitFormErrors>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const kit = useMemo(
    () => (isNew ? null : (kits?.find((k) => k.id === id) ?? null)),
    [kits, id, isNew]
  );

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [list, webProducts] = await Promise.all([fetchKits(), fetchWebProducts()]);
      setKits(list);
      setProducts(webProducts);
      const initial: Values = isNew
        ? { name: "", nameFr: "", published: true, items: [] }
        : (() => {
            const found = list.find((k) => k.id === id);
            return found ? fromKit(found) : { name: "", nameFr: "", published: true, items: [] };
          })();
      setValues(initial);
      setBaseline(initial);
    } catch (failure) {
      setLoadError(errorKey(failure));
    }
  }, [id, isNew]);

  useEffect(() => {
    if (isOwner) void load();
  }, [isOwner, load]);

  const dirty = !!values && !!baseline && JSON.stringify(values) !== JSON.stringify(baseline);
  useEffect(() => {
    setDirty(dirty);
  });

  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  // The kit as it would be saved, among the other kits (for the 20-kit limit).
  const draftStatus = useMemo(() => {
    if (!values || !kits) return null;
    const draftId = isNew ? NEW : id;
    const others = kits.filter((k) => k.id !== draftId);
    const draft: WebKit = {
      id: draftId,
      name: values.name,
      name_fr: values.nameFr || null,
      published: values.published,
      sort: kit?.sort ?? Number.MAX_SAFE_INTEGER,
      items: values.items.map((line, index) => ({ ...line, sort: index * 10 })),
    };
    return kitStatuses([...others, draft], products).get(draftId) ?? null;
  }, [values, kits, products, kit, id, isNew]);

  if (profile && !isOwner) return <Redirect href="/(app)/sell" />;
  if (!isOwner) return null;
  if (loadError) {
    return (
      <LoadError
        title={t("webstore.kits.loadError")}
        reasonKey={loadError}
        onRetry={() => void load()}
      />
    );
  }
  if (!kits || !values) return <ActivityIndicator style={styles.loading} />;
  if (!isNew && !kit) return <EmptyState icon="package" title={t("webstore.kits.notFound")} />;

  const set = <K extends keyof Values>(key: K, value: Values[K]) => {
    setValues((v) => (v ? { ...v, [key]: value } : v));
    if (key === "name") setErrors((e) => ({ ...e, name: undefined }));
    if (key === "nameFr") setErrors((e) => ({ ...e, nameFr: undefined }));
  };
  const setItems = (items: Line[]) => {
    set("items", items);
    setErrors((e) => ({ ...e, items: undefined, qty: undefined }));
  };

  const setQty = (index: number, qty: number) =>
    setItems(values.items.map((line, i) => (i === index ? { ...line, qty: clampQty(qty) } : line)));
  const move = (index: number, dir: -1 | 1) => {
    const to = index + dir;
    if (to < 0 || to >= values.items.length) return;
    const next = [...values.items];
    [next[index], next[to]] = [next[to], next[index]];
    setItems(next);
  };
  const removeAt = (index: number) => setItems(values.items.filter((_, i) => i !== index));
  const add = (product: WebProduct) => {
    if (values.items.length >= FEED_KIT_ITEM_LIMIT) return;
    setItems([...values.items, { web_product_id: product.id, qty: 1 }]);
    setAdding(false);
  };

  const full = values.items.length >= FEED_KIT_ITEM_LIMIT;
  const inKit = new Set(values.items.map((i) => i.web_product_id));
  const itemsChanged = JSON.stringify(values.items) !== JSON.stringify(baseline?.items);

  const save = async () => {
    setSaveError(null);
    const { errors: found, patch } = validateKit({
      name: values.name,
      nameFr: values.nameFr,
      items: values.items,
    });
    setErrors(found);
    if (!patch) return;
    setSaving(true);
    try {
      if (isNew) {
        const newId = newKitId(
          patch.name,
          kits.map((k) => k.id)
        );
        await createKit({ id: newId, ...patch, published: values.published });
        try {
          await saveKitItems(newId, values.items);
        } catch (failure) {
          // Do not leave an empty kit behind.
          await deleteKit(newId).catch(() => undefined);
          throw failure;
        }
      } else if (kit) {
        await updateKit(kit.id, { ...patch, published: values.published });
        if (itemsChanged) await saveKitItems(kit.id, values.items, baseline?.items ?? []);
      }
      setDirty(false);
      showToast({ text: t("webstore.kits.saved"), tone: "success" });
      leave();
    } catch (failure) {
      setSaveError(errorKey(failure));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!kit) return;
    const ok = await confirmDestructive(
      t("webstore.kits.deleteTitle", { name: isolateBidi(kitDisplayName(kit)) }),
      t("webstore.kits.deleteMessage"),
      t("webstore.kits.deleteButton"),
      t("common.cancel")
    );
    if (!ok) return;
    try {
      await deleteKit(kit.id);
      setDirty(false);
      leave();
    } catch {
      showToast({ text: t("webstore.kits.deleteError"), tone: "info" });
    }
  };

  const err = (key: keyof KitFormErrors) => (errors[key] ? t(errors[key] as string) : undefined);

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Card title={t("webstore.kits.detailsTitle")} style={styles.card}>
        <Field
          label={t("webstore.kits.fName")}
          value={values.name}
          onChangeText={(text) => set("name", text)}
          error={err("name")}
        />
        <Field
          label={t("webstore.kits.fNameFr")}
          value={values.nameFr}
          onChangeText={(text) => set("nameFr", text)}
          error={err("nameFr")}
        />
        <SwitchRow
          label={t("webstore.kits.publishedLabel")}
          value={values.published}
          onValueChange={(on) => set("published", on)}
        />
      </Card>

      <Card title={t("webstore.kits.itemsTitle")} style={styles.card}>
        {values.items.length === 0 ? (
          <Text style={styles.hint}>{t("webstore.kits.itemsEmpty")}</Text>
        ) : (
          values.items.map((line, index) => {
            const product = byId.get(line.web_product_id) ?? null;
            const problem =
              index >= FEED_KIT_ITEM_LIMIT
                ? ("tooManyItems" as const)
                : itemProblem(line.web_product_id, byId);
            return (
              <KitItemRow
                key={line.web_product_id}
                webProductId={line.web_product_id}
                product={product}
                qty={line.qty}
                problem={problem}
                isFirst={index === 0}
                isLast={index === values.items.length - 1}
                onQty={(qty) => setQty(index, qty)}
                onMove={(dir) => move(index, dir)}
                onRemove={() => removeAt(index)}
              />
            );
          })
        )}
        {err("items") ? <Text style={styles.error}>{err("items")}</Text> : null}
        {err("qty") ? <Text style={styles.error}>{err("qty")}</Text> : null}
        {adding ? (
          <>
            <KitProductPicker products={products} excludeIds={inKit} onPick={add} />
            <BigButton
              label={t("common.cancel")}
              variant="secondary"
              onPress={() => setAdding(false)}
            />
          </>
        ) : (
          <>
            <BigButton
              label={t("webstore.kits.addItem")}
              variant="secondary"
              disabled={full}
              onPress={() => setAdding(true)}
            />
            {full ? (
              <Text style={styles.hint}>
                {t("webstore.kits.itemsFull", { max: FEED_KIT_ITEM_LIMIT })}
              </Text>
            ) : null}
          </>
        )}
      </Card>

      {draftStatus ? (
        <Card title={t("webstore.kits.summaryTitle")} style={styles.card}>
          <Text style={styles.big}>
            {draftStatus.priceCents === null
              ? t("webstore.kits.priceIncomplete")
              : keepNumberLtr(formatMAD(draftStatus.priceCents))}
          </Text>
          <Text style={styles.hint}>{t("webstore.kits.priceHint")}</Text>
          <Banner
            tone={draftStatus.shownOnSite ? "ok" : "warn"}
            text={statusLine(t, draftStatus, byId)}
          />
        </Card>
      ) : null}

      {saveError ? <InlineError reasonKey={saveError} /> : null}
      <BigButton
        label={saving ? t("common.saving") : t("webstore.kits.save")}
        disabled={saving}
        onPress={() => void save()}
      />
      {!isNew ? (
        <BigButton
          label={t("webstore.kits.deleteButton")}
          variant="danger"
          disabled={saving}
          onPress={() => void remove()}
        />
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  loading: { marginTop: 40 },
  content: { padding: 12, gap: 12, paddingBottom: 40 },
  card: { gap: 10 },
  big: { fontSize: 22, fontWeight: "700", color: colors.ink900 },
  hint: { fontSize: 14, color: colors.ink600, lineHeight: 20 },
  error: { fontSize: 14, color: colors.danger700 },
});
