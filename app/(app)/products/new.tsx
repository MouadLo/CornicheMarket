import { Redirect, router } from "expo-router";
import { useEffect, useState } from "react";

import { ProductForm } from "@/src/components/products/ProductForm";
import { useAuth } from "@/src/lib/auth/AuthProvider";
import { createProduct, fetchCategories, type Category } from "@/src/lib/products/queries";

export default function NewProduct() {
  const { profile } = useAuth();
  const [categories, setCategories] = useState<Category[]>([]);

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
      categories={categories}
      submitLabel="Create product"
      onSubmit={async (input) => {
        await createProduct(input);
        router.back();
      }}
    />
  );
}
