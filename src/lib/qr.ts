import qrcode from "qrcode-generator";

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
