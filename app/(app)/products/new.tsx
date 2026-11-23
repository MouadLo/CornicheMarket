import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { ProductForm } from "@/src/components/products/ProductForm";
import { ProductPhotoSection } from "@/src/components/products/ProductPhotoSection";
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
import {
  copyCompetitorPhoto,
  fetchCompetitorItemImageUrl,
  uploadProductPhoto,
  type PreparedPhoto,
} from "@/src/lib/products/photos";
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
  // The photo the owner picked on this form, uploaded once the product exists.
  const pendingPhoto = useRef<PreparedPhoto | null>(null);
  // The photo step runs once, even if saving is retried after a later failure.
  const photoDone = useRef(false);
  // From À sourcer: the competitor's photo, shown in the form right away and
  // copied into our storage on save. Null when the item has none, or once the
  // owner removed it or picked their own.
  const [suggestedUrl, setSuggestedUrl] = useState<string | null>(null);
  const suggestedKept = useRef(true);

  useEffect(() => {
    fetchCategories()
      .then(setCategories)
      .catch(() => setCategories([]));
  }, []);

  useEffect(() => {
    if (!competitorItemId) return;
    let live = true;
    fetchCompetitorItemImageUrl(competitorItemId)
      .then((url) => {
        if (live) setSuggestedUrl(url);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [competitorItemId]);

  if (profile && profile.role !== "owner") {
    return <Redirect href="/(app)/products" />;
  }

  return (
    <ProductForm
      onDirtyChange={setDirty}
      categories={categories}
      initialName={startName}
      header={
        <ProductPhotoSection
          productId={null}
          canEdit
          onPendingChange={(photo) => {
            pendingPhoto.current = photo;
          }}
          suggestedUrl={suggestedUrl}
          onSuggestedRemoved={() => {
            suggestedKept.current = false;
          }}
        />
      }
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
        // The photo: the one the owner picked, else the competitor item's. A
        // failure only warns: the product is kept.
        if (!photoDone.current) {
          photoDone.current = true;
          const productId = createdId.current;
          try {
            if (pendingPhoto.current) {
              await uploadProductPhoto(productId, pendingPhoto.current);
            } else if (competitorItemId && suggestedKept.current) {
              const imageUrl =
                suggestedUrl ?? (await fetchCompetitorItemImageUrl(competitorItemId));
              if (imageUrl) {
                const result = await copyCompetitorPhoto(imageUrl, productId);
                if (result !== "saved") throw new Error(result);
              }
            }
          } catch {
            showToast({ text: t("products.photo.attachFailed"), tone: "info" });
          }
        }
        router.back();
        // Created from "À sourcer": go back to that tab, refreshed, rather than
        // to the products list.
        if (competitorItemId) {
          router.navigate({
            pathname: "/(app)/competitors",
            params: { tab: "sourcing", r: String(Date.now()) },
          });
        }
      }}
    />
  );
}
