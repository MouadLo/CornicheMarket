import type { StyleProp, TextStyle } from "react-native";

import { formatMADGrouped } from "@/src/lib/money";
import { Text } from "@/src/theme/Text";
import { colors } from "@/src/theme/tokens";
import { tabularNumbers, type TypeToken, typeScale } from "@/src/theme/type";

// Left-to-right isolate: "3 482.50 DH" reads the same inside Arabic text.
const LRI = "⁦";
const PDI = "⁩";

type Props = {
  cents: number;
  size?: TypeToken;
  // "flow" colours by direction (money in green, out red) and always adds the
  // sign: colour is never the only signal.
  tone?: "default" | "flow" | "muted";
  style?: StyleProp<TextStyle>;
};

export function moneyLabel(cents: number, signed: boolean): string {
  const text = formatMADGrouped(cents);
  return `${signed && cents > 0 ? "+" : ""}${text}`;
}

export function Money({ cents, size = "body", tone = "default", style }: Props) {
  const flow = tone === "flow";
  const color =
    tone === "muted"
      ? colors.ink600
      : flow && cents > 0
        ? colors.success700
        : flow && cents < 0
          ? colors.danger600
          : colors.ink900;
  const weight =
    typeScale[size].weight === "regular"
      ? "600"
      : typeScale[size].weight === "semibold"
        ? "600"
        : "700";
  return (
    <Text
      accessibilityLabel={moneyLabel(cents, flow)}
      style={[
        { fontSize: typeScale[size].latin, color, fontWeight: weight },
        tabularNumbers,
        style,
      ]}
    >
      {`${LRI}${moneyLabel(cents, flow)}${PDI}`}
    </Text>
  );
}
