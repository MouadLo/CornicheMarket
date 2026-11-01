import { View, useWindowDimensions } from "react-native";

import { colors } from "@/src/theme/tokens";

const PIECE = 20;

// The shop's valance under the top bar: alternating scallops in two blues.
// Decorative only (hidden from screen readers), 10 px tall.
export function Awning() {
  const { width } = useWindowDimensions();
  const count = Math.ceil(width / PIECE) + 1;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ height: 10, flexDirection: "row", overflow: "hidden", backgroundColor: colors.bg }}
    >
      {Array.from({ length: count }, (_, i) => (
        <View
          key={i}
          style={{
            width: PIECE,
            height: 10,
            backgroundColor: i % 2 === 0 ? colors.brand800 : colors.brand100,
            borderBottomLeftRadius: PIECE / 2,
            borderBottomRightRadius: PIECE / 2,
          }}
        />
      ))}
    </View>
  );
}
