import Svg, { Circle, ClipPath, Defs, G, Path, Rect } from "react-native-svg";

// The Corniche mark: a shop awning over a "C" that doubles as the curve of the
// bay, with the sun in sand (docs/THEME-STRUCTURE.md 2.1).
export function BrandMark({ size = 36 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" accessibilityElementsHidden>
      <Defs>
        <ClipPath id="awn">
          <Rect x={6} y={10} width={36} height={9} rx={2} />
        </ClipPath>
      </Defs>
      <Rect width={48} height={48} rx={12} fill="#0b5266" />
      <G clipPath="url(#awn)">
        <Path d="M6 10h36v8H6z" fill="#ffffff" />
        <Path d="M6 10h6v8H6zM18 10h6v8h-6zM30 10h6v8h-6z" fill="#e3f0f3" />
      </G>
      <Path
        d="M6 18a3 3 0 0 0 6 0a3 3 0 0 0 6 0a3 3 0 0 0 6 0a3 3 0 0 0 6 0a3 3 0 0 0 6 0a3 3 0 0 0 6 0"
        fill="#ffffff"
      />
      <Circle cx={33} cy={31} r={4} fill="#e9a93a" />
      <Path
        d="M27 26.5a9 9 0 1 0 0 11"
        fill="none"
        stroke="#ffffff"
        strokeWidth={4}
        strokeLinecap="round"
      />
    </Svg>
  );
}
