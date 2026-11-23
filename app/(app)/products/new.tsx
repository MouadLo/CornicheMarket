import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { ProductForm } from "@/src/components/products/ProductForm";
import { useUnsavedGuard } from "@/src/lib/products/useUnsavedGuard";
import { useAuth } from "@/src/lib/auth/AuthProvider";
import { confirmMatch } from "@/src/lib/competitors/shops";
import { showToast } from "@/src/lib/dialog/store";
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
  // From "À sourcer" > "Créer le produit": the competitor item to link to the
  // product once it is saved, and its name to start from.
  const params = useLocalSearchParams<{ competitorItemId?: string; name?: string }>();
  const competitorItemId =
    typeof params.competitorItemId === "string" ? params.competitorItemId : null;
  const startName = typeof params.name === "string" ? params.name : undefined;
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
      initialName={startName}
      initialTile={DEFAULT_TILE_SETTINGS}
      submitLabel={t("products.formCreate")}
      onSubmit={async (input, tile) => {
        if (createdId.current) await updateProduct(createdId.current, input);
        else createdId.current = await createProduct(input);
        if (tile) {
          await saveProductTileSettings(createdId.current, tile.tabCategoryId, tile.settings);
          void refreshGridCache(true);
        }
        // The product exists now: link the competitor item to it. A failure here
        // must not lose or duplicate the product, so it only warns.
        if (competitorItemId) {
          try {
            await confirmMatch(competitorItemId, createdId.current);
            showToast({ text: t("competitors.sourcingTab.linked"), tone: "success" });
          } catch {
            showToast({ text: t("competitors.sourcingTab.linkFailed"), tone: "info" });
          }
        }
        router.back();
      }}
    />
  );
}
