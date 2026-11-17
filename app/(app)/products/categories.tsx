import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";

import { useAuth } from "@/src/lib/auth/AuthProvider";
import { confirm, showToast } from "@/src/lib/dialog/store";
import { decideCategory, inTreeOrder, MAX_CATEGORY_NAME } from "@/src/lib/products/categories";
import {
  CATEGORY_CATALOG,
  categoryLabel,
  categoryPathLabel,
  existingFor,
  findCatalogEntry,
  subSuggestionsFor,
  type CatalogSub,
} from "@/src/lib/products/categoryCatalog";
import {
  canDelete,
  canMergeOrMove,
  decideLink,
  decideRename,
  mergeTargets,
  moveTargets,
} from "@/src/lib/products/categoryManage";
import {
  createCategory,
  deleteCategory,
  fetchCategoriesWithCounts,
  linkCategoryToCatalog,
  mergeCategory,
  renameCategory,
  setCategoryParent,
  type CategoryWithCount,
} from "@/src/lib/products/queries";
import { Text } from "@/src/theme/Text";
import { colors, radius } from "@/src/theme/tokens";

type Mode = "rename" | "link" | "merge" | "addSub" | "move" | null;

export default function CategoriesScreen() {
  const { profile } = useAuth();
  const { t, i18n } = useTranslation();
  const lang = i18n?.language;
  const isOwner = profile?.role === "owner";

  const [categories, setCategories] = useState<CategoryWithCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>(null);
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setCategories(await fetchCategoriesWithCounts());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t("products.catError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const label = (category: { name: string; code?: string | null }) => categoryLabel(category, lang);

  const pathLabel = (category: CategoryWithCount) => categoryPathLabel(category, categories, lang);

  // The stored name is French for standard categories; sort by what is shown,
  // each main category followed by its sub-categories.
  const sorted = useMemo(
    () =>
      inTreeOrder(
        [...categories].sort((a, b) =>
          categoryLabel(a, lang).localeCompare(categoryLabel(b, lang), lang)
        )
      ),
    [categories, lang]
  );

  const parentOf = (category: CategoryWithCount) =>
    categories.find((other) => other.id === category.parent_id);

  // The standard entries this category can be linked to: main ones for a main
  // category, the standard parent's subs for a sub-category.
  const linkOptions = (category: CategoryWithCount): readonly CatalogSub[] => {
    if (!category.parent_id) return CATEGORY_CATALOG;
    const parent = CATEGORY_CATALOG.find((entry) => entry.code === parentOf(category)?.code);
    return parent?.subs ?? [];
  };

  const close = () => {
    setOpenId(null);
    setMode(null);
    setNote(null);
  };

  const toggle = (category: CategoryWithCount) => {
    if (openId === category.id) return close();
    setOpenId(category.id);
    setMode(null);
    setNote(null);
    setDraft(category.name);
  };

  // Runs a change, reloads, and reports it; keeps the panel open on failure.
  const run = async (action: () => Promise<void>, done: string) => {
    setBusy(true);
    try {
      await action();
      close();
      showToast({ text: done, tone: "success" });
      await load();
    } catch {
      setNote(t("products.catError"));
    } finally {
      setBusy(false);
    }
  };

  const handleRename = (category: CategoryWithCount) => {
    const decision = decideRename(category, draft, categories);
    if (decision.kind === "invalid") {
      return setNote(t("products.formCategoryInvalid", { max: MAX_CATEGORY_NAME }));
    }
    if (decision.kind === "unchanged") return close();
    if (decision.kind === "standard") return setNote(t("products.catStandardNoRename"));
    if (decision.kind === "clash") {
      return setNote(t("products.catClash", { name: label(decision.other) }));
    }
    void run(() => renameCategory(category.id, decision.name), t("products.catRenamed"));
  };

  const handleMerge = async (source: CategoryWithCount, target: CategoryWithCount) => {
    const ok = await confirm({
      tone: "danger",
      title: t("products.catMergeConfirmTitle", {
        from: pathLabel(source),
        into: pathLabel(target),
      }),
      message: t("products.catMergeMessage", {
        count: source.productCount,
        from: pathLabel(source),
        into: pathLabel(target),
      }),
      confirmLabel: t("products.catMergeConfirm"),
    });
    if (!ok) return;
    void run(
      () => mergeCategory(source.id, target.id),
      t("products.catMerged", { name: pathLabel(target) })
    );
  };

  const handleLink = (category: CategoryWithCount, entry: CatalogSub) => {
    const decision = decideLink(category, entry, categories);
    if (decision.kind === "already") return setNote(t("products.catAlreadyStandard"));
    if (decision.kind === "merge") {
      const target = categories.find((other) => other.id === decision.target.id);
      if (target) void handleMerge(category, target);
      return;
    }
    void run(
      () => linkCategoryToCatalog(category.id, decision.name, decision.code),
      t("products.catLinked", { name: entry[lang === "ar" || lang === "en" ? lang : "fr"] })
    );
  };

  const addSub = (parent: CategoryWithCount, name: string, code: string | null) =>
    run(
      () => createCategory(name, code, parent.id).then(() => undefined),
      t("products.catSubAdded", { name: code ? label({ name, code }) : name })
    );

  const handleAddSubTyped = (parent: CategoryWithCount) => {
    const decision = decideCategory(draft, categories);
    if (decision.kind === "invalid") {
      return setNote(t("products.formCategoryInvalid", { max: MAX_CATEGORY_NAME }));
    }
    if (decision.kind === "existing") {
      return setNote(t("products.catClash", { name: label(decision.category) }));
    }
    void addSub(parent, decision.name, null);
  };

  const handleAddSubStandard = (parent: CategoryWithCount, entry: CatalogSub) => {
    const same = existingFor(entry, categories);
    if (same) return setNote(t("products.catClash", { name: label(same) }));
    void addSub(parent, entry.fr, entry.code);
  };

  const handleMove = (category: CategoryWithCount, parent: CategoryWithCount | null) =>
    void run(
      () => setCategoryParent(category.id, parent?.id ?? null),
      parent ? t("products.catMoved", { name: label(parent) }) : t("products.catMadeMain")
    );

  const handleDelete = async (category: CategoryWithCount) => {
    const ok = await confirm({
      tone: "danger",
      title: t("products.catDeleteConfirmTitle", { name: label(category) }),
      message: t("products.catDeleteMessage"),
      confirmLabel: t("products.catDelete"),
    });
    if (!ok) return;
    void run(() => deleteCategory(category.id), t("products.catDeleted"));
  };

  if (!isOwner) return null;
  if (loading) return <ActivityIndicator style={styles.loader} />;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {error && <Text style={styles.error}>{error}</Text>}
      {!error && categories.length === 0 && (
        <Text style={styles.muted}>{t("products.catEmpty")}</Text>
      )}

      {sorted.map((category) => {
        const open = openId === category.id;
        const standard = Boolean(findCatalogEntry(category.code));
        const isSub = Boolean(category.parent_id);
        const subCount = categories.filter((other) => other.parent_id === category.id).length;
        const free = canMergeOrMove(category, categories);
        return (
          <View
            key={category.id}
            style={[styles.card, isSub && styles.subCard, open && styles.cardOpen]}
          >
            <Pressable
              style={styles.row}
              onPress={() => toggle(category)}
              accessibilityRole="button"
              accessibilityState={{ expanded: open }}
            >
              <View style={styles.rowText}>
                <Text style={styles.name}>{label(category)}</Text>
                <Text style={styles.muted}>
                  {t("products.catProducts", { count: category.productCount })}
                  {subCount > 0 ? ` · ${t("products.catSubCount", { count: subCount })}` : ""}
                </Text>
              </View>
              {standard && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{t("products.catStandard")}</Text>
                </View>
              )}
            </Pressable>

            {open && (
              <View style={styles.panel}>
                {mode === null && (
                  <View style={styles.actions}>
                    {!standard && (
                      <Action label={t("products.catRename")} onPress={() => setMode("rename")} />
                    )}
                    {!standard && linkOptions(category).length > 0 && (
                      <Action label={t("products.catLink")} onPress={() => setMode("link")} />
                    )}
                    {!isSub && (
                      <Action
                        label={t("products.catAddSub")}
                        onPress={() => {
                          setDraft("");
                          setMode("addSub");
                        }}
                      />
                    )}
                    {free && moveTargets(category, categories).length > 0 && (
                      <Action label={t("products.catMove")} onPress={() => setMode("move")} />
                    )}
                    {isSub && (
                      <Action
                        label={t("products.catMakeMain")}
                        onPress={() => handleMove(category, null)}
                      />
                    )}
                    {free && categories.length > 1 && (
                      <Action label={t("products.catMerge")} onPress={() => setMode("merge")} />
                    )}
                    <Action
                      label={t("products.catDelete")}
                      danger
                      onPress={() =>
                        canDelete(category, categories)
                          ? void handleDelete(category)
                          : setNote(
                              subCount > 0
                                ? t("products.catHasSubs")
                                : t("products.catDeleteBlocked")
                            )
                      }
                    />
                  </View>
                )}

                {mode === "rename" && (
                  <View style={styles.renameRow}>
                    <TextInput
                      style={styles.input}
                      value={draft}
                      onChangeText={setDraft}
                      maxLength={MAX_CATEGORY_NAME + 10}
                      autoFocus
                      onSubmitEditing={() => handleRename(category)}
                    />
                    <Action
                      label={t("products.catSave")}
                      primary
                      onPress={() => handleRename(category)}
                    />
                  </View>
                )}

                {mode === "link" && (
                  <>
                    <Text style={styles.muted}>
                      {t("products.catLinkTitle", { name: label(category) })}
                    </Text>
                    <View style={styles.chips}>
                      {linkOptions(category).map((entry) => (
                        <Action
                          key={entry.code}
                          label={categoryLabel({ name: entry.fr, code: entry.code }, lang)}
                          onPress={() => handleLink(category, entry)}
                        />
                      ))}
                    </View>
                  </>
                )}

                {mode === "addSub" && (
                  <>
                    {subSuggestionsFor(category, categories).length > 0 && (
                      <>
                        <Text style={styles.muted}>{t("products.catSubSuggested")}</Text>
                        <View style={styles.chips}>
                          {subSuggestionsFor(category, categories).map((entry) => (
                            <Action
                              key={entry.code}
                              label={categoryLabel({ name: entry.fr, code: entry.code }, lang)}
                              onPress={() => handleAddSubStandard(category, entry)}
                            />
                          ))}
                        </View>
                      </>
                    )}
                    <View style={styles.renameRow}>
                      <TextInput
                        style={styles.input}
                        value={draft}
                        onChangeText={setDraft}
                        placeholder={t("products.catSubName")}
                        maxLength={MAX_CATEGORY_NAME + 10}
                        onSubmitEditing={() => handleAddSubTyped(category)}
                      />
                      <Action
                        label={t("products.catSubAdd")}
                        primary
                        onPress={() => handleAddSubTyped(category)}
                      />
                    </View>
                  </>
                )}

                {mode === "move" && (
                  <>
                    <Text style={styles.muted}>
                      {t("products.catMoveTitle", { name: label(category) })}
                    </Text>
                    <View style={styles.chips}>
                      {moveTargets(category, sorted).map((target) => (
                        <Action
                          key={target.id}
                          label={label(target)}
                          onPress={() => handleMove(category, target)}
                        />
                      ))}
                    </View>
                  </>
                )}

                {mode === "merge" && (
                  <>
                    <Text style={styles.muted}>
                      {t("products.catMergeTitle", { name: label(category) })}
                    </Text>
                    <View style={styles.chips}>
                      {mergeTargets(category, sorted).map((target) => (
                        <Action
                          key={target.id}
                          label={pathLabel(target)}
                          onPress={() => void handleMerge(category, target)}
                        />
                      ))}
                    </View>
                  </>
                )}

                {note && <Text style={styles.note}>{note}</Text>}
                {busy && <ActivityIndicator />}
                {mode !== null && (
                  <Pressable
                    onPress={() => {
                      setMode(null);
                      setNote(null);
                    }}
                    style={styles.back}
                  >
                    <Text style={styles.link}>{t("products.catCancel")}</Text>
                  </Pressable>
                )}
              </View>
            )}
          </View>
        );
      })}
    </ScrollView>
  );
}

function Action({
  label,
  onPress,
  danger,
  primary,
}: {
  label: string;
  onPress: () => void;
  danger?: boolean;
  primary?: boolean;
}) {
  return (
    <Pressable
      style={[styles.action, danger && styles.actionDanger, primary && styles.actionPrimary]}
      onPress={onPress}
      accessibilityRole="button"
    >
      <Text
        style={[
          styles.actionText,
          danger && styles.actionTextDanger,
          primary && styles.actionTextPrimary,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, gap: 10, maxWidth: 720, width: "100%", alignSelf: "center" },
  loader: { marginTop: 40 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  cardOpen: { borderColor: colors.brand600 },
  subCard: { marginStart: 28 },
  row: { flexDirection: "row", alignItems: "center", padding: 14, gap: 12, minHeight: 56 },
  rowText: { flex: 1, gap: 2 },
  name: { fontSize: 17, fontWeight: "600", color: colors.ink900 },
  muted: { fontSize: 14, color: colors.ink600 },
  badge: {
    backgroundColor: colors.brand100,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  badgeText: { fontSize: 13, color: colors.brand800, fontWeight: "600" },
  panel: {
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    padding: 14,
    gap: 10,
  },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  action: {
    minHeight: 44,
    paddingHorizontal: 14,
    justifyContent: "center",
    borderRadius: radius.control,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  actionDanger: { borderColor: colors.danger600 },
  actionPrimary: { backgroundColor: colors.brand700, borderColor: colors.brand700 },
  actionText: { fontSize: 15, fontWeight: "600", color: colors.ink900 },
  actionTextDanger: { color: colors.danger700 },
  actionTextPrimary: { color: colors.white },
  renameRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  input: {
    flex: 1,
    minHeight: 44,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.control,
    paddingHorizontal: 12,
    fontSize: 16,
    color: colors.ink900,
    backgroundColor: colors.surface,
  },
  note: { fontSize: 14, color: colors.danger700 },
  error: { fontSize: 15, color: colors.danger700 },
  back: { alignSelf: "flex-start", paddingVertical: 6 },
  link: { fontSize: 15, color: colors.brand700, fontWeight: "600" },
});
