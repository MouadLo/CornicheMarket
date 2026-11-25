import { Redirect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { BigButton } from "@/src/components/BigButton";
import { Banner } from "@/src/components/ui/Banner";
import { Card } from "@/src/components/ui/Card";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { Field } from "@/src/components/ui/Field";
import { InlineError } from "@/src/components/ui/InlineError";
import { LoadError } from "@/src/components/ui/LoadError";
import { CategoryIcon } from "@/src/components/webstore/CategoryIcon";
import { IconButton } from "@/src/components/webstore/IconButton";
import { ChoiceChips } from "@/src/components/webstore/ChoiceChips";
import { useAuth } from "@/src/lib/auth/AuthProvider";
import { confirmDestructive } from "@/src/lib/confirmDestructive";
import { showToast } from "@/src/lib/dialog/store";
import { errorKey } from "@/src/lib/errors/userMessage";
import { useLeaveScreen } from "@/src/lib/nav/useLeaveScreen";
import { useUnsavedGuard } from "@/src/lib/products/useUnsavedGuard";
import { isolateBidi } from "@/src/lib/text/bidi";
import {
  CATEGORY_ICONS,
  categoryName,
  newCategoryId,
  newSubCode,
  shownIcon,
  subUsageKey,
  validateIconChoice,
  validateNames,
  type NamesErrors,
  type UsageCounts,
} from "@/src/lib/webstore/categories";
import {
  createCategory,
  createSub,
  deleteCategory,
  deleteSub,
  fetchUsageCounts,
  InUseError,
  moveSub,
  updateCategory,
  updateSub,
} from "@/src/lib/webstore/categoryQueries";
import { fetchWebCategories } from "@/src/lib/webstore/queries";
import type { WebCategory, WebSubcategory } from "@/src/lib/webstore/types";
import { Text } from "@/src/theme/Text";
import { colors } from "@/src/theme/tokens";

const NEW = "new";

type Values = { name: string; nameFr: string; icon: string };

// Owner only. Edits one category of the site ("new" creates one): its names
// and icon (saved with the button), and its sub-categories (each action saves
// at once). A category or sub-category that products use cannot be deleted.
export default function WebstoreCategoryEdit() {
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

  const [categories, setCategories] = useState<WebCategory[] | null>(null);
  const [usage, setUsage] = useState<UsageCounts>({ byCategory: {}, bySub: {} });
  const [loadError, setLoadError] = useState<string | null>(null);
  const [values, setValues] = useState<Values | null>(null);
  const [baseline, setBaseline] = useState<Values | null>(null);
  const [errors, setErrors] = useState<NamesErrors & { icon?: string }>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // A refusal ("in use") or a failure of an action that saves at once.
  const [notice, setNotice] = useState<{ tone: "warn" | "bad"; text: string } | null>(null);

  const category = useMemo(
    () => (isNew ? null : (categories?.find((c) => c.id === id) ?? null)),
    [categories, id, isNew]
  );

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [list, counts] = await Promise.all([fetchWebCategories(), fetchUsageCounts()]);
      setCategories(list);
      setUsage(counts);
      const found = isNew ? null : list.find((c) => c.id === id);
      const initial: Values = found
        ? { name: found.name, nameFr: found.name_fr, icon: shownIcon(found.icon) }
        : { name: "", nameFr: "", icon: "bag" };
      setValues((v) => v ?? initial);
      setBaseline((b) => b ?? initial);
    } catch (failure) {
      setLoadError(errorKey(failure));
    }
  }, [id, isNew]);

  useEffect(() => {
    if (isOwner) void load();
  }, [isOwner, load]);

  // After a sub-category action: take the new list, keep what was typed above.
  const reload = useCallback(async () => {
    const [list, counts] = await Promise.all([fetchWebCategories(), fetchUsageCounts()]);
    setCategories(list);
    setUsage(counts);
  }, []);

  const dirty = !!values && !!baseline && JSON.stringify(values) !== JSON.stringify(baseline);
  useEffect(() => {
    setDirty(dirty);
  });

  if (profile && !isOwner) return <Redirect href="/(app)/sell" />;
  if (!isOwner) return null;
  if (loadError && !categories) {
    return (
      <LoadError
        title={t("webstore.cats.loadError")}
        reasonKey={loadError}
        onRetry={() => void load()}
      />
    );
  }
  if (!categories || !values) return <ActivityIndicator style={styles.loading} />;
  if (!isNew && !category) return <EmptyState icon="package" title={t("webstore.cats.notFound")} />;

  const set = <K extends keyof Values>(key: K, value: Values[K]) => {
    setValues((v) => (v ? { ...v, [key]: value } : v));
    setErrors((e) => ({ ...e, [key === "nameFr" ? "nameFr" : key]: undefined }));
  };

  const inUseText = (key: "category" | "sub", count: number) =>
    count > 0
      ? t(key === "category" ? "webstore.cats.inUse" : "webstore.cats.subInUse", { count })
      : t(key === "category" ? "webstore.cats.inUseSome" : "webstore.cats.subInUseSome");

  const save = async () => {
    setSaveError(null);
    setNotice(null);
    const { errors: nameErrors, names } = validateNames(values);
    const iconError = validateIconChoice(values.icon);
    setErrors({ ...nameErrors, ...(iconError ? { icon: iconError } : {}) });
    if (!names || iconError) return;
    setSaving(true);
    try {
      if (isNew) {
        await createCategory({
          id: newCategoryId(
            names.name,
            categories.map((c) => c.id)
          ),
          ...names,
          icon: values.icon,
        });
      } else if (category) {
        await updateCategory(category.id, { ...names, icon: values.icon });
      }
      setDirty(false);
      showToast({ text: t("webstore.cats.saved"), tone: "success" });
      leave();
    } catch (failure) {
      setSaveError(errorKey(failure));
    } finally {
      setSaving(false);
    }
  };

  const removeCategory = async () => {
    if (!category) return;
    setNotice(null);
    const used = usage.byCategory[category.id] ?? 0;
    if (used > 0) {
      setNotice({ tone: "warn", text: inUseText("category", used) });
      return;
    }
    const ok = await confirmDestructive(
      t("webstore.cats.deleteTitle", { name: isolateBidi(categoryName(category)) }),
      t("webstore.cats.deleteMessage"),
      t("webstore.cats.deleteButton"),
      t("common.cancel")
    );
    if (!ok) return;
    try {
      await deleteCategory(category.id);
      setDirty(false);
      leave();
    } catch (failure) {
      if (failure instanceof InUseError) {
        setNotice({ tone: "warn", text: inUseText("category", failure.count) });
      } else {
        setNotice({ tone: "bad", text: t("webstore.cats.deleteError") });
      }
    }
  };

  const err = (key: "name" | "nameFr" | "icon") =>
    errors[key] ? t(errors[key] as string) : undefined;

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {notice ? <Banner tone={notice.tone} text={notice.text} /> : null}
      <Card title={t("webstore.cats.detailsTitle")} style={styles.card}>
        <Field
          label={t("webstore.cats.fName")}
          value={values.name}
          onChangeText={(text) => set("name", text)}
          error={err("name")}
        />
        <Field
          label={t("webstore.cats.fNameFr")}
          value={values.nameFr}
          onChangeText={(text) => set("nameFr", text)}
          error={err("nameFr")}
        />
        <Text style={styles.label}>{t("webstore.cats.fIcon")}</Text>
        <ChoiceChips
          options={CATEGORY_ICONS.map((icon) => ({
            key: icon,
            label: t(`webstore.cats.icon.${icon}`),
          }))}
          value={values.icon}
          onChange={(key) => key && set("icon", key)}
        />
        <View style={styles.preview}>
          <CategoryIcon icon={values.icon} size={28} />
        </View>
        {err("icon") ? <Text style={styles.error}>{err("icon")}</Text> : null}
        {saveError ? <InlineError reasonKey={saveError} /> : null}
        <BigButton
          label={saving ? t("common.saving") : t("webstore.cats.save")}
          disabled={saving}
          onPress={() => void save()}
        />
      </Card>

      {category ? (
        <SubsCard
          category={category}
          usage={usage}
          inUseText={(count) => inUseText("sub", count)}
          setNotice={setNotice}
          reload={reload}
        />
      ) : (
        <Text style={styles.hint}>{t("webstore.cats.subsAfterSave")}</Text>
      )}

      {category ? (
        <BigButton
          label={t("webstore.cats.deleteButton")}
          variant="danger"
          disabled={saving}
          onPress={() => void removeCategory()}
        />
      ) : null}
    </ScrollView>
  );
}

type SubsProps = {
  category: WebCategory;
  usage: UsageCounts;
  inUseText: (count: number) => string;
  setNotice: (n: { tone: "warn" | "bad"; text: string } | null) => void;
  reload: () => Promise<void>;
};

// The sub-categories of one category. Every action saves at once.
function SubsCard({ category, usage, inUseText, setNotice, reload }: SubsProps) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: "", nameFr: "" });
  const [draftErrors, setDraftErrors] = useState<NamesErrors>({});
  const [adding, setAdding] = useState({ name: "", nameFr: "" });
  const [addErrors, setAddErrors] = useState<NamesErrors>({});
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<void>, failText: string) => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      await action();
      await reload();
    } catch (failure) {
      if (failure instanceof InUseError) {
        setNotice({ tone: "warn", text: inUseText(failure.count) });
      } else {
        setNotice({ tone: "bad", text: failText });
      }
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (sub: WebSubcategory) => {
    setEditing(sub.code);
    setDraft({ name: sub.name, nameFr: sub.name_fr });
    setDraftErrors({});
  };

  const saveEdit = (sub: WebSubcategory) => {
    const { errors, names } = validateNames(draft);
    setDraftErrors(errors);
    if (!names) return;
    void run(async () => {
      await updateSub(category.id, sub.code, names);
      setEditing(null);
    }, t("webstore.cats.subError"));
  };

  const addSub = () => {
    const { errors, names } = validateNames(adding);
    setAddErrors(errors);
    if (!names) return;
    void run(async () => {
      await createSub(category.id, {
        code: newSubCode(
          names.name,
          category.subs.map((s) => s.code)
        ),
        ...names,
      });
      setAdding({ name: "", nameFr: "" });
    }, t("webstore.cats.subError"));
  };

  const removeSub = async (sub: WebSubcategory) => {
    setNotice(null);
    const used = usage.bySub[subUsageKey(category.id, sub.code)] ?? 0;
    if (used > 0) {
      setNotice({ tone: "warn", text: inUseText(used) });
      return;
    }
    const ok = await confirmDestructive(
      t("webstore.cats.subDeleteTitle", { name: isolateBidi(sub.name_fr || sub.name) }),
      t("webstore.cats.subDeleteMessage"),
      t("webstore.cats.subDeleteButton"),
      t("common.cancel")
    );
    if (!ok) return;
    void run(() => deleteSub(category.id, sub.code), t("webstore.cats.subError"));
  };

  return (
    <Card title={t("webstore.cats.subsTitle")} style={styles.card}>
      {category.subs.length === 0 ? (
        <Text style={styles.hint}>{t("webstore.cats.subsEmpty")}</Text>
      ) : null}
      {category.subs.map((sub, index) => {
        const name = sub.name_fr || sub.name;
        const used = usage.bySub[subUsageKey(category.id, sub.code)] ?? 0;
        return (
          <View key={sub.code} style={styles.subRow}>
            {editing === sub.code ? (
              <>
                <Field
                  label={t("webstore.cats.fName")}
                  value={draft.name}
                  onChangeText={(text) => setDraft((d) => ({ ...d, name: text }))}
                  error={draftErrors.name ? t(draftErrors.name) : undefined}
                />
                <Field
                  label={t("webstore.cats.fNameFr")}
                  value={draft.nameFr}
                  onChangeText={(text) => setDraft((d) => ({ ...d, nameFr: text }))}
                  error={draftErrors.nameFr ? t(draftErrors.nameFr) : undefined}
                />
                <BigButton
                  label={t("webstore.cats.subSave")}
                  disabled={busy}
                  onPress={() => saveEdit(sub)}
                />
                <BigButton
                  label={t("common.cancel")}
                  variant="secondary"
                  onPress={() => setEditing(null)}
                />
              </>
            ) : (
              <>
                <View style={styles.subText}>
                  <Text style={styles.subTitle} numberOfLines={1}>
                    {isolateBidi(name)}
                  </Text>
                  <Text style={styles.hint}>
                    {sub.name && sub.name !== name ? `${isolateBidi(sub.name)} · ` : ""}
                    {t("webstore.cats.productsCount", { count: used })}
                  </Text>
                </View>
                <View style={styles.subActions}>
                  <IconButton
                    icon="arrowUp"
                    label={t("webstore.cats.subMoveUp", { name })}
                    disabled={index === 0 || busy}
                    onPress={() =>
                      void run(
                        () =>
                          moveSub(
                            category.id,
                            category.subs.map((s) => ({ code: s.code, sort: s.sort })),
                            sub.code,
                            -1
                          ),
                        t("webstore.cats.subError")
                      )
                    }
                  />
                  <IconButton
                    icon="arrowDown"
                    label={t("webstore.cats.subMoveDown", { name })}
                    disabled={index === category.subs.length - 1 || busy}
                    onPress={() =>
                      void run(
                        () =>
                          moveSub(
                            category.id,
                            category.subs.map((s) => ({ code: s.code, sort: s.sort })),
                            sub.code,
                            1
                          ),
                        t("webstore.cats.subError")
                      )
                    }
                  />
                  <IconButton
                    icon="pencil"
                    label={t("webstore.cats.subRename", { name })}
                    onPress={() => startEdit(sub)}
                  />
                  <IconButton
                    icon="trash"
                    label={t("webstore.cats.subDelete", { name })}
                    onPress={() => void removeSub(sub)}
                  />
                </View>
              </>
            )}
          </View>
        );
      })}
      <Text style={styles.label}>{t("webstore.cats.subAddTitle")}</Text>
      <Field
        label={t("webstore.cats.fName")}
        value={adding.name}
        onChangeText={(text) => setAdding((a) => ({ ...a, name: text }))}
        error={addErrors.name ? t(addErrors.name) : undefined}
      />
      <Field
        label={t("webstore.cats.fNameFr")}
        value={adding.nameFr}
        onChangeText={(text) => setAdding((a) => ({ ...a, nameFr: text }))}
        error={addErrors.nameFr ? t(addErrors.nameFr) : undefined}
      />
      <BigButton label={t("webstore.cats.subAdd")} disabled={busy} onPress={addSub} />
    </Card>
  );
}

const styles = StyleSheet.create({
  loading: { marginTop: 40 },
  content: { padding: 12, gap: 12, paddingBottom: 40 },
  card: { gap: 10 },
  label: { fontSize: 14, fontWeight: "700", color: colors.ink700 },
  hint: { fontSize: 14, color: colors.ink600, lineHeight: 20 },
  error: { fontSize: 14, color: colors.danger700 },
  preview: { alignSelf: "flex-start" },
  subRow: {
    gap: 8,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  subText: { gap: 2 },
  subTitle: { fontSize: 16, fontWeight: "600", color: colors.ink900 },
  subActions: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
});
