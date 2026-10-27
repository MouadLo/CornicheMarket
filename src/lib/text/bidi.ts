// Unicode "First Strong Isolate" / "Pop Directional Isolate". Wrapping a
// string in these isolates its own paragraph-direction detection (which
// the Unicode Bidi Algorithm derives from the string's first strong
// character) from whatever is around it.
//
// Without this, a product name that happens to start with an Arabic
// character gets auto-detected as an RTL run even inside an otherwise-LTR
// (French/English) row, which flips that one piece of text's own
// alignment to the right while its sibling (e.g. a "7 piece · 245.00 DH"
// subtitle, which starts with a digit) stays left -- the name jumps to
// the right edge, the subtitle stays at the left, with a big gap between
// them. Isolating the name stops its script from leaking out and
// affecting anything around it.
//
// This works identically on iOS, Android and web, since it is part of the
// text content itself -- not a CSS/style property that only some
// platforms honour.
const FIRST_STRONG_ISOLATE = "⁨";
const POP_DIRECTIONAL_ISOLATE = "⁩";

export function isolateBidi(text: string): string {
  return `${FIRST_STRONG_ISOLATE}${text}${POP_DIRECTIONAL_ISOLATE}`;
}

// The app's current layout direction, derived from the i18n language --
// never from the content being displayed. Use this for any row/container
// whose layout order must follow the UI language, not whatever happens to
// be in it.
export function appDirection(language: string): "ltr" | "rtl" {
  return language === "ar" ? "rtl" : "ltr";
}
