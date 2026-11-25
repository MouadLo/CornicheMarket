import { Redirect, router } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";

import { BigButton } from "@/src/components/BigButton";
import { ProductSearchPicker } from "@/src/components/stock/ProductSearchPicker";
import { Card } from "@/src/components/ui/Card";
import { Field } from "@/src/components/ui/Field";
import { InlineError } from "@/src/components/ui/InlineError";
import { LoadError } from "@/src/components/ui/LoadError";
import { Segmented } from "@/src/components/ui/Segmented";
import { ChoiceChips } from "@/src/components/webstore/ChoiceChips";
import { useAuth } from "@/src/lib/auth/AuthProvider";
import { errorKey } from "@/src/lib/errors/userMessage";
import { isolateBidi } from "@/src/lib/text/bidi";
import { createWebProduct, fetchWebCategories } from "@/src/lib/webstore/queries";
import type { WebCategory } from "@/src/lib/webstore/types";
import type { Product } from "@/src/lib/products/queries";
import { Text } from "@/src/theme/Text";
import { colors } from "@/src/theme/tokens";

type Mode = "app" | "free";

// Owner only. Starts a web product, either from an app product (name copied,
// linked) or free (typed by hand). It is created hidden; the edit screen opens
// next to finish it.
export default function WebstoreNew() {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const isOwner = profile?.role === "owner";
  const [categories, setCategories] = useState<WebCategory[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("app");
  const [picked, setPicked] = useState<Product | null>(null);
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    setLoadError(null);
    fetchWebCategories()
      .then(setCategories)
      .catch((e) => setLoadError(errorKey(e)));
  };
  useEffect(() => {
    if (isOwner) load();
  }, [isOwner]);

  if (profile && !isOwner) return <Redirect href="/(app)/sell" />;
  if (!isOwner) return null;
  if (loadError) {
    return <LoadError title={t("webstore.loadError")} reasonKey={loadError} onRetry={load} />;
  }
  if (!categories) return <ActivityIndicator style={styles.loading} />;

  const create = async () => {
    setFailure(null);
    const chosenName = mode === "app" ? (picked?.name ?? "") : name.trim();
    if (mode === "app" && !picked) return setProblem("webstore.newNeedProduct");
    if (mode === "free" && !chosenName) return setProblem("webstore.newNeedName");
    if (!categoryId) return setProblem("webstore.newNeedCategory");
    setProblem(null);
    setBusy(true);
    try {
      const id = await createWebProduct({
        name: chosenName,
        name_fr: chosenName,
        category_id: categoryId,
        product_id: mode === "app" ? (picked?.id ?? null) : null,
      });
      router.replace(`/(app)/webstore/${id}`);
    } catch (e) {
      setFailure(errorKey(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Segmented
        value={mode}
        onChange={(m) => {
          setMode(m);
          setProblem(null);
        }}
        options={[
          { key: "app", label: t("webstore.newFromApp") },
          { key: "free", label: t("webstore.newFree") },
        ]}
      />
      <Card style={styles.card}>
        {mode === "app" ? (
          <>
            <Text style={styles.hint}>{t("webstore.newFromAppHint")}</Text>
            {picked ? (
              <Text style={styles.picked}>
                {t("webstore.newPickedProduct", { name: isolateBidi(picked.name) })}
              </Text>
            ) : null}
            <ProductSearchPicker excludeIds={picked ? [picked.id] : []} onPick={setPicked} />
          </>
        ) : (
          <>
            <Text style={styles.hint}>{t("webstore.newFreeHint")}</Text>
            <Field label={t("webstore.newName")} value={name} onChangeText={setName} />
          </>
        )}
      </Card>
      <Card title={t("webstore.newCategory")} style={styles.card}>
        <ChoiceChips
          options={categories.map((c) => ({ key: c.id, label: c.name_fr || c.name }))}
          value={categoryId}
          onChange={setCategoryId}
        />
      </Card>
      {problem ? <Text style={styles.error}>{t(problem)}</Text> : null}
      {failure ? <InlineError reasonKey={failure} /> : null}
      <BigButton label={t("webstore.newCreate")} disabled={busy} onPress={() => void create()} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  loading: { marginTop: 40 },
  content: { padding: 12, gap: 12, paddingBottom: 40 },
  card: { gap: 10 },
  hint: { fontSize: 14, color: colors.ink600, lineHeight: 20 },
  picked: { fontSize: 16, fontWeight: "600", color: colors.ink900 },
  error: { fontSize: 14, color: colors.danger700 },
});
