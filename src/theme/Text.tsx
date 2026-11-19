import { Children, type ReactNode } from "react";
import { Text as RNText, StyleSheet, type TextProps } from "react-native";
import { useTranslation } from "react-i18next";

import { keepNumberLtr } from "@/src/lib/text/bidi";
import { fontFamilyFor, weightFromStyle, type Lang } from "./type";

// Arabic lines are right to left, but a plain number or amount inside one is
// not. Only plain text is touched; nested elements keep their own rules.
function arabicContent(children: ReactNode): ReactNode {
  const parts = Children.toArray(children);
  if (parts.length === 0) return children;
  if (!parts.every((part) => typeof part === "string" || typeof part === "number")) return children;
  return keepNumberLtr(parts.join(""));
}

// Drop-in for react-native's Text: picks the Plex family for the current
// language and the weight the style asks for (custom fonts have no weight
// axis on native). Everything else in the style passes through untouched.
export function Text({ style, children, ...rest }: TextProps) {
  const { i18n } = useTranslation();
  const lang = (i18n?.language as Lang | undefined) ?? "fr";
  const flat = StyleSheet.flatten(style) ?? {};
  const family = flat.fontFamily ?? fontFamilyFor(lang, weightFromStyle(flat.fontWeight));
  return (
    <RNText
      {...rest}
      style={[
        { writingDirection: lang === "ar" ? "rtl" : "ltr" },
        style,
        { fontFamily: family, fontWeight: "normal" },
      ]}
    >
      {lang === "ar" ? arabicContent(children) : children}
    </RNText>
  );
}
