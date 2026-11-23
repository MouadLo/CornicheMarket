import { useEffect, useState } from "react";
import { Image, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { Icon } from "@/src/components/ui/Icon";
import { usePhotoUrl } from "@/src/lib/products/photoUrls";
import { colors } from "@/src/theme/tokens";

type Props = {
  path: string | null | undefined;
  size: number;
  radius?: number;
  // Draw a neutral icon when there is no photo (lists, the edit page). Off: nothing.
  placeholder?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  testID?: string;
};

// A product's photo from its storage path. Never a broken image: while the URL is
// unknown (offline, not signed yet) or the file fails to load, the placeholder
// shows (or nothing).
export function ProductPhoto({
  path,
  size,
  radius = 8,
  placeholder = true,
  style,
  accessibilityLabel,
  testID,
}: Props) {
  const url = usePhotoUrl(path);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  const box = { width: size, height: size, borderRadius: radius };

  if (url && !failed) {
    return (
      <Image
        source={{ uri: url }}
        style={[styles.image, box, style as object]}
        resizeMode="cover"
        accessibilityLabel={accessibilityLabel}
        accessibilityIgnoresInvertColors
        onError={() => setFailed(true)}
        testID={testID ?? "product-photo"}
      />
    );
  }
  if (!placeholder) return null;
  return (
    <View style={[styles.placeholder, box, style]} testID="product-photo-placeholder">
      <Icon name="package" size={Math.round(size * 0.5)} color={colors.ink400} />
    </View>
  );
}

const styles = StyleSheet.create({
  image: { backgroundColor: colors.sunken },
  placeholder: { backgroundColor: colors.sunken, alignItems: "center", justifyContent: "center" },
});
