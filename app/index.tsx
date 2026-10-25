import { ActivityIndicator, View } from "react-native";

// The root NavigationGuard (app/_layout.tsx) redirects away from here as
// soon as it knows whether there's a session. This is just what's on
// screen for the brief moment before that happens.
export default function Index() {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <ActivityIndicator />
    </View>
  );
}
