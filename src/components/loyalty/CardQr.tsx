import { useMemo } from "react";
import Svg, { Path, Rect } from "react-native-svg";

import { qrMatrix, qrPath } from "@/src/lib/qr";

export { qrMatrix, qrPath };

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
