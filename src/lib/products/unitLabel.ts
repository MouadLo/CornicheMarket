// Product units (piece/kg/pack) were rendered as their raw English
// database values everywhere they appeared on screen -- never translated,
// and never pluralized ("1 piece" / "7 piece" both showed "piece"). A
// generic `(t: TFunction)` param, rather than importing i18next's own
// TFunction type, keeps this free of a hard dependency on exactly which
// i18next version's type signature is installed.
type Translate = (key: string, options?: { count: number }) => string;

export function unitLabel(unit: string, quantity: number, t: Translate): string {
  switch (unit) {
    case "piece":
      return t("units.piece", { count: quantity });
    case "pack":
      return t("units.pack", { count: quantity });
    case "kg":
      return t("units.kg", { count: quantity });
    default:
      return unit;
  }
}
