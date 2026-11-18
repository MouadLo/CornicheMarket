import { Redirect, router } from "expo-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { ProductForm } from "@/src/components/products/ProductForm";
import { useUnsavedGuard } from "@/src/lib/products/useUnsavedGuard";
import { useAuth } from "@/src/lib/auth/AuthProvider";
import { createProduct, fetchCategories, type Category } from "@/src/lib/products/queries";

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
      submitLabel={t("products.formCreate")}
      onSubmit={async (input) => {
        await createProduct(input);
        router.back();
      }}
    />
  );
}
