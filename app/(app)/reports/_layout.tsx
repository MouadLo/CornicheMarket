import { Stack } from "expo-router";
import { sectionStackOptions } from "@/src/components/nav/SectionBackButton";

export default function ReportsLayout() {
  return (
    <Stack screenOptions={sectionStackOptions}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
    </Stack>
  );
}
