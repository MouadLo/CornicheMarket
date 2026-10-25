import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Text } from "react-native";

import { ProductForm } from "@/src/components/products/ProductForm";
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
  const isOwner = profile?.role === "owner";

  const [categories, setCategories] = useState<Category[]>([]);
  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id || !isOwner) return;

    Promise.all([fetchCategories(), fetchProduct(id, true)])
      .then(([loadedCategories, loadedProduct]) => {
        setCategories(loadedCategories);
        setProduct(loadedProduct);
      })
      .catch((loadError) =>
        setError(loadError instanceof Error ? loadError.message : "Could not load the product.")
      )
      .finally(() => setLoading(false));
  }, [id, isOwner]);

  if (profile && !isOwner) {
    return <Redirect href="/(app)/products" />;
  }

  if (loading) return <ActivityIndicator style={{ marginTop: 40 }} />;
  if (error) return <Text style={{ padding: 20, color: "#b3261e" }}>{error}</Text>;
  if (!product) return <Text style={{ padding: 20 }}>Product not found.</Text>;

  return (
    <ProductForm
      categories={categories}
      initial={product}
      submitLabel="Save changes"
      onSubmit={async (input) => {
        await updateProduct(product.id, input);
        router.back();
      }}
    />
  );
}
