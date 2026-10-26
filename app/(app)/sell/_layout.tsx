import { Stack } from "expo-router";

export default function SellLayout() {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="credit" options={{ title: "Customer credit" }} />
      <Stack.Screen name="history" options={{ title: "Recent sales" }} />
      <Stack.Screen name="stuck" options={{ title: "Stuck sales" }} />
    </Stack>
  );
}
