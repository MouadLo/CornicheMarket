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
import { fetchProductTileSettings, saveProductTileSettings } from "@/src/lib/sellGrid/queries";
import { refreshGridCache } from "@/src/lib/sellGrid/refresh";
import { mainCategoryId } from "@/src/lib/products/categories";
import type { TileSettings } from "@/src/lib/sellGrid/tileSettings";

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
  // Undefined when the grid could not be read: the form then hides its Sell
  // controls and saves the product alone, rather than blocking the edit.
  const [tile, setTile] = useState<TileSettings | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // A translation key (see errorKey), never the server's text.
  const load = useCallback(() => {
    if (!id || !isOwner) return;

    setLoading(true);
    setError(null);
    Promise.all([fetchCategories(), fetchProduct(id, true)])
      .then(async ([loadedCategories, loadedProduct]) => {
        const tabCategoryId = mainCategoryId(loadedCategories, loadedProduct?.category_id ?? null);
        const loadedTile = loadedProduct
          ? await fetchProductTileSettings(loadedProduct.id, tabCategoryId).catch(() => undefined)
          : undefined;
        setCategories(loadedCategories);
        setTile(loadedTile);
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
      initialTile={tile}
      submitLabel={t("products.formSave")}
      onSubmit={async (input, change) => {
        await updateProduct(product.id, input);
        if (change) {
          await saveProductTileSettings(product.id, change.tabCategoryId, change.settings);
          void refreshGridCache(true);
        }
        router.back();
      }}
    />
  );
}
