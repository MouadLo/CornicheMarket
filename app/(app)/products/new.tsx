import { Redirect, router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { ProductForm } from "@/src/components/products/ProductForm";
import { useUnsavedGuard } from "@/src/lib/products/useUnsavedGuard";
import { useAuth } from "@/src/lib/auth/AuthProvider";
import {
  createProduct,
  fetchCategories,
  updateProduct,
  type Category,
} from "@/src/lib/products/queries";
import { saveProductTileSettings } from "@/src/lib/sellGrid/queries";
import { refreshGridCache } from "@/src/lib/sellGrid/refresh";
import { DEFAULT_TILE_SETTINGS } from "@/src/lib/sellGrid/tileSettings";

export default function NewProduct() {
  const { profile } = useAuth();
  const { t } = useTranslation();
  const [categories, setCategories] = useState<Category[]>([]);
  const guardTexts = {
    title: t("products.formUnsavedTitle"),
    message: t("products.formUnsavedMessage"),
    leave: t("products.formUnsavedLeave"),
    stay: t("products.formUnsavedStay"),
  };
  const setDirty = useUnsavedGuard(guardTexts);

  // Set once the product exists: if the grid settings then fail, saving again
  // updates this product instead of creating a second one.
  const createdId = useRef<string | null>(null);

  useEffect(() => {
    fetchCategories()
      .then(setCategories)
      .catch(() => setCategories([]));
  }, []);

  if (profile && profile.role !== "owner") {
    return <Redirect href="/(app)/products" />;
  }

  return (
    <ProductForm
      onDirtyChange={setDirty}
      categories={categories}
      initialTile={DEFAULT_TILE_SETTINGS}
      submitLabel={t("products.formCreate")}
      onSubmit={async (input, tile) => {
        if (createdId.current) await updateProduct(createdId.current, input);
        else createdId.current = await createProduct(input);
        if (tile) {
          await saveProductTileSettings(createdId.current, tile.tabCategoryId, tile.settings);
          void refreshGridCache(true);
        }
        router.back();
      }}
    />
  );
}
