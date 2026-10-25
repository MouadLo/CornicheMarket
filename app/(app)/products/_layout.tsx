import { Stack } from "expo-router";

export default function ProductsLayout() {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="new" options={{ title: "New product" }} />
      <Stack.Screen name="[id]" options={{ title: "Edit product" }} />
      <Stack.Screen name="import" options={{ title: "Import products" }} />
      <Stack.Screen name="history/[id]" options={{ title: "Buying price history" }} />
    </Stack>
  );
}
