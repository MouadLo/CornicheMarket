import { useEffect, useState } from "react";
import { Image, StyleSheet, View } from "react-native";

import { Icon } from "@/src/components/ui/Icon";
import { colors, radius } from "@/src/theme/tokens";

// A product photo from its address. No address, or an address that fails to
// load: a plain icon, never a broken image.
export function WebImage({ uri, size = 48 }: { uri: string | null; size?: number }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [uri]);
  const box = { width: size, height: size };
  if (!uri || failed) {
    return (
      <View style={[styles.box, box]} testID="web-image-fallback">
        <Icon name="package" size={Math.round(size / 2)} color={colors.ink400} />
      </View>
    );
  }
  return (
    <Image
      source={{ uri }}
      style={[styles.box, box]}
      resizeMode="cover"
      onError={() => setFailed(true)}
      accessibilityIgnoresInvertColors
    />
  );
}

const styles = StyleSheet.create({
  box: {
    borderRadius: radius.control,
    backgroundColor: colors.sunken,
    alignItems: "center",
    justifyContent: "center",
  },
});
