import { Stack } from "expo-router";

export default function StockInLayout() {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="history" options={{ title: "Purchase history" }} />
      <Stack.Screen name="low-stock" options={{ title: "Low stock & reorder" }} />
      <Stack.Screen name="adjust" options={{ title: "Stock adjustments" }} />
      <Stack.Screen name="count" options={{ title: "Stock count" }} />
      <Stack.Screen name="expiring" options={{ title: "Expiring soon" }} />
      <Stack.Screen name="negative-stock" options={{ title: "Negative stock" }} />
    </Stack>
  );
}
