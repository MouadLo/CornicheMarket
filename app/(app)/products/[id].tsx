import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Text } from "react-native";
import { useTranslation } from "react-i18next";

import { ProductForm } from "@/src/components/products/ProductForm";
import { LoadError } from "@/src/components/ui/LoadError";
import { errorKey } from "@/src/lib/errors/userMessage";
import { useUnsavedGuard } from "@/src/lib/products/useUnsavedGuard";
import { useAuth } from "@/src/lib/auth/AuthProvider";
import {
  fetchCategories,
  fetchProduct,
  updateProduct,
  type Category,
  type Product,
} from "@/src/lib/products/queries";

export default function EditProduct() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { profile } = useAuth();
  const { t } = useTranslation();
  const isOwner = profile?.role === "owner";
  const guardTexts = {
    title: t("products.formUnsavedTitle"),
    message: t("products.formUnsavedMessage"),
    leave: t("products.formUnsavedLeave"),
    stay: t("products.formUnsavedStay"),
  };
  const setDirty = useUnsavedGuard(guardTexts);

  const [categories, setCategories] = useState<Category[]>([]);
  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // A translation key (see errorKey), never the server's text.
  const load = useCallback(() => {
    if (!id || !isOwner) return;

    setLoading(true);
    setError(null);
    Promise.all([fetchCategories(), fetchProduct(id, true)])
      .then(([loadedCategories, loadedProduct]) => {
        setCategories(loadedCategories);
        setProduct(loadedProduct);
      })
      .catch((failure) => setError(errorKey(failure)))
      .finally(() => setLoading(false));
  }, [id, isOwner]);

  useEffect(load, [load]);

  if (profile && !isOwner) {
    return <Redirect href="/(app)/products" />;
  }

  if (loading) return <ActivityIndicator style={{ marginTop: 40 }} />;
  if (error)
    return <LoadError title={t("products.formLoadError")} reasonKey={error} onRetry={load} />;
  if (!product) return <Text style={{ padding: 20 }}>{t("products.formProductNotFound")}</Text>;

  return (
    <ProductForm
      onDirtyChange={setDirty}
      categories={categories}
      initial={product}
      submitLabel={t("products.formSave")}
      onSubmit={async (input) => {
        await updateProduct(product.id, input);
        router.back();
      }}
    />
  );
}
