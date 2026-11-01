import { Text as RNText, StyleSheet, type TextProps } from "react-native";
import { useTranslation } from "react-i18next";

import { fontFamilyFor, weightFromStyle, type Lang } from "./type";

// Drop-in for react-native's Text: picks the Plex family for the current
// language and the weight the style asks for (custom fonts have no weight
// axis on native). Everything else in the style passes through untouched.
export function Text({ style, ...rest }: TextProps) {
  const { i18n } = useTranslation();
  const lang = (i18n?.language as Lang | undefined) ?? "fr";
  const flat = StyleSheet.flatten(style) ?? {};
  const family = flat.fontFamily ?? fontFamilyFor(lang, weightFromStyle(flat.fontWeight));
  return <RNText {...rest} style={[style, { fontFamily: family, fontWeight: "normal" }]} />;
}
