import qrcode from "qrcode-generator";
import { useMemo } from "react";
import Svg, { Path, Rect } from "react-native-svg";

// The dark/light module grid of a QR code (error correction M: the card must
// scan from a cracked phone screen too). Version is picked by the library.
export function qrMatrix(text: string): boolean[][] {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const size = qr.getModuleCount();
  return Array.from({ length: size }, (_row, y) =>
    Array.from({ length: size }, (_cell, x) => qr.isDark(y, x))
  );
}

// One SVG path for every dark module; horizontal runs are merged, so the path
// stays short and has no seams between neighbours.
export function qrPath(matrix: boolean[][], quiet: number): string {
  const parts: string[] = [];
  matrix.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (!row[x]) {
        x += 1;
        continue;
      }
      const start = x;
      while (x < row.length && row[x]) x += 1;
      parts.push(`M${start + quiet} ${y + quiet}h${x - start}v1h-${x - start}z`);
    }
  });
  return parts.join("");
}

type Props = { value: string; size?: number; label?: string };

// A black-on-white QR with its quiet zone, drawn with react-native-svg so it
// is identical on the web, iOS and Android. Always black on white: the
// scanner at the counter needs the contrast, whatever the theme.
export function CardQr({ value, size = 248, label }: Props) {
  const QUIET = 4;
  const { matrix, path } = useMemo(() => {
    const m = qrMatrix(value);
    return { matrix: m, path: qrPath(m, QUIET) };
  }, [value]);
  const modules = matrix.length + QUIET * 2;
  return (
    <Svg
      width={size}
      height={size}
      viewBox={`0 0 ${modules} ${modules}`}
      accessibilityRole="image"
      accessibilityLabel={label}
      testID="card-qr"
    >
      <Rect x={0} y={0} width={modules} height={modules} fill="#ffffff" />
      <Path d={path} fill="#000000" />
    </Svg>
  );
}
