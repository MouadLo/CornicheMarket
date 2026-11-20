// Barcode text as cameras and USB scanners report it, and how a scanned code is
// matched to the barcode a product was saved with. Pure, so it is unit tested.
//
// The same product can come back as different text depending on the reader:
// - an iPhone reports a 12-digit UPC-A as a 13-digit EAN-13 with a leading 0,
//   Android, zxing and most USB scanners report the 12 digits;
// - a short UPC-E (8 digits) is the compressed form of a 12-digit UPC-A, and
//   some readers expand it;
// - a USB scanner set to a US keyboard, plugged into an AZERTY (French) PC,
//   types the digit row unshifted: "&é\"'(-è_çà" instead of "1234567890".
// Products are saved with whatever the owner typed or scanned that day, so the
// lookup tries every equivalent form, preferring the exact text.

export type BarcodeFormatName =
  "ean13" | "ean8" | "upca" | "upce" | "code128" | "code39" | "code93" | "itf" | "unknown";

// Readers name formats differently: expo-camera "ean13" / "upc_e", the browser
// BarcodeDetector "ean_13", zxing "EAN_13", iOS "org.gs1.EAN-13".
export function normalizeFormat(type: string | null | undefined): BarcodeFormatName {
  const key = (type ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (key.includes("ean13")) return "ean13";
  if (key.includes("ean8")) return "ean8";
  if (key.includes("upca")) return "upca";
  if (key.includes("upce")) return "upce";
  if (key.includes("code128")) return "code128";
  if (key.includes("code39")) return "code39";
  if (key.includes("code93")) return "code93";
  if (key.includes("itf") || key.includes("interleaved")) return "itf";
  return "unknown";
}

// The digit row of an AZERTY keyboard, unshifted, in the order 1..9, 0.
const AZERTY_DIGITS: Record<string, string> = {
  "&": "1",
  é: "2",
  '"': "3",
  "'": "4",
  "(": "5",
  "-": "6",
  è: "7",
  _: "8",
  ç: "9",
  à: "0",
};

// Cleans one read: control characters, the AIM symbology prefix some scanners
// are set to send ("]E0..."), Code 39 start/stop stars, spaces inside a
// numeric code, and the AZERTY digit row. Returns "" when nothing is left.
export function cleanScannedCode(raw: string): string {
  // eslint-disable-next-line no-control-regex
  let code = raw.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  code = code.replace(/^\][A-Za-z][0-9A-Za-z]/, "");
  if (/^\*.+\*$/.test(code)) code = code.slice(1, -1);
  code = code.trim();
  const chars = [...code];
  if (chars.length >= 4 && chars.every((c) => c in AZERTY_DIGITS)) {
    code = chars.map((c) => AZERTY_DIGITS[c]).join("");
  }
  if (/^\d[\d ]*\d$/.test(code)) code = code.replace(/ /g, "");
  return code;
}

// GS1 check digit (EAN-8, UPC-A, EAN-13, GTIN-14): the last digit.
export function isValidGtin(code: string): boolean {
  if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(code)) return false;
  let sum = 0;
  for (let i = code.length - 2, weight = 3; i >= 0; i -= 1, weight = 4 - weight) {
    sum += Number(code[i]) * weight;
  }
  return (10 - (sum % 10)) % 10 === Number(code[code.length - 1]);
}

// UPC-E (8 digits: number system 0/1, six digits, check) to its UPC-A.
export function upcEToUpcA(code: string): string | null {
  if (!/^[01]\d{7}$/.test(code)) return null;
  const n = code[0];
  const d = code.slice(1, 7);
  const check = code[7];
  const last = d[5];
  let body: string;
  if (last <= "2") body = `${d[0]}${d[1]}${last}0000${d[2]}${d[3]}${d[4]}`;
  else if (last === "3") body = `${d[0]}${d[1]}${d[2]}00000${d[3]}${d[4]}`;
  else if (last === "4") body = `${d[0]}${d[1]}${d[2]}${d[3]}00000${d[4]}`;
  else body = `${d.slice(0, 5)}0000${last}`;
  const upcA = `${n}${body}${check}`;
  return isValidGtin(upcA) ? upcA : null;
}

// UPC-A to its UPC-E, when the product number allows the short form.
export function upcAToUpcE(code: string): string | null {
  if (!/^[01]\d{11}$/.test(code)) return null;
  const n = code[0];
  const m = code.slice(1, 11);
  const check = code[11];
  const candidates: string[] = [];
  if (m.slice(3, 7) === "0000" && m[2] <= "2")
    candidates.push(`${m[0]}${m[1]}${m.slice(7)}${m[2]}`);
  if (m.slice(3, 8) === "00000") candidates.push(`${m.slice(0, 3)}${m.slice(8)}3`);
  if (m.slice(4, 9) === "00000") candidates.push(`${m.slice(0, 4)}${m[9]}4`);
  if (m.slice(5, 9) === "0000" && m[9] >= "5") candidates.push(`${m.slice(0, 5)}${m[9]}`);
  for (const six of candidates) {
    const upcE = `${n}${six}${check}`;
    if (upcEToUpcA(upcE) === code) return upcE;
  }
  return null;
}

// Every text a product with this barcode may have been saved as, the scanned
// text first. Only numeric retail codes have other forms.
export function barcodeVariants(code: string): string[] {
  const out = [code];
  const add = (value: string | null) => {
    if (value && !out.includes(value)) out.push(value);
  };
  if (!/^\d+$/.test(code)) return out;

  let upcA: string | null = null;
  if (code.length === 13 && code.startsWith("0")) upcA = code.slice(1);
  else if (code.length === 12) upcA = code;
  else if (code.length === 14 && code.startsWith("00")) upcA = code.slice(2);
  else if (code.length === 8) upcA = upcEToUpcA(code);

  if (code.length === 14 && code.startsWith("0")) add(code.slice(1));
  if (upcA) {
    add(upcA);
    add(`0${upcA}`);
    add(upcAToUpcE(upcA));
  }
  return out;
}

// The best row for a scanned code among rows found by its variants: the exact
// text first, then the variants in order.
export function pickByBarcode<T extends { barcode: string | null }>(
  code: string,
  rows: readonly T[]
): T | null {
  const variants = barcodeVariants(code);
  let best: T | null = null;
  let bestRank = Infinity;
  for (const row of rows) {
    const rank = row.barcode === null ? -1 : variants.indexOf(row.barcode);
    if (rank >= 0 && rank < bestRank) {
      best = row;
      bestRank = rank;
    }
  }
  return best;
}

// Whether two saved barcodes stand for the same product.
export function sameBarcode(a: string, b: string): boolean {
  return a === b || barcodeVariants(a).includes(b);
}
