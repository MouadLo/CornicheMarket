import {
  barcodeVariants,
  cleanScannedCode,
  isValidGtin,
  normalizeFormat,
  pickByBarcode,
  sameBarcode,
  upcAToUpcE,
  upcEToUpcA,
} from "../../src/lib/scanner/barcode";

describe("normalizeFormat", () => {
  it.each([
    ["ean13", "ean13"],
    ["ean_13", "ean13"],
    ["EAN_13", "ean13"],
    ["org.gs1.EAN-13", "ean13"],
    ["upc_a", "upca"],
    ["UPC_E", "upce"],
    ["org.gs1.UPC-E", "upce"],
    ["ean_8", "ean8"],
    ["CODE_128", "code128"],
    ["org.iso.Code39Mod43", "code39"],
    ["qr", "qr"],
    ["qr_code", "qr"],
    ["QR_CODE", "qr"],
    ["org.iso.QRCode", "qr"],
    ["aztec", "unknown"],
    [undefined, "unknown"],
  ])("%s → %s", (input, expected) => {
    expect(normalizeFormat(input)).toBe(expected);
  });
});

describe("cleanScannedCode", () => {
  it("leaves a card URL (QR from a 2D USB scanner) intact", () => {
    const url = "https://shop.example.com/card/AbC_dEf-1234567890abcd";
    expect(cleanScannedCode(url)).toBe(url);
    expect(cleanScannedCode(`${url}\r\n`)).toBe(url);
    expect(cleanScannedCode(`]Q1${url}`)).toBe(url);
  });

  it("keeps a clean code as it is", () => {
    expect(cleanScannedCode("6111234567890")).toBe("6111234567890");
    expect(cleanScannedCode("ABC-123")).toBe("ABC-123");
  });

  it("drops control characters, line ends and the AIM prefix", () => {
    expect(cleanScannedCode("6111234567890\r\n")).toBe("6111234567890");
    expect(cleanScannedCode("\u00026111234567890\u0003")).toBe("6111234567890");
    expect(cleanScannedCode("]E06111234567890")).toBe("6111234567890");
    expect(cleanScannedCode("]C1ABC123")).toBe("ABC123");
  });

  it("drops Code 39 start/stop stars", () => {
    expect(cleanScannedCode("*CM-0042*")).toBe("CM-0042");
  });

  it("drops spaces inside a numeric code only", () => {
    expect(cleanScannedCode(" 6 111234 567890 ")).toBe("6111234567890");
    expect(cleanScannedCode("LOT 12")).toBe("LOT 12");
  });

  it("turns the AZERTY digit row typed by a US-layout scanner back into digits", () => {
    // 6111234567890 typed on an AZERTY keyboard without Shift.
    expect(cleanScannedCode("-&&&é\"'(-è_çà")).toBe("6111234567890");
    expect(cleanScannedCode("_&&&")).toBe("8111");
  });

  it("does not translate short or mixed text", () => {
    expect(cleanScannedCode("é-à")).toBe("é-à");
    expect(cleanScannedCode("A&é\"'")).toBe("A&é\"'");
  });

  it("returns empty for nothing but noise", () => {
    expect(cleanScannedCode("\r\n  ")).toBe("");
  });
});

describe("isValidGtin", () => {
  it.each(["036000291452", "0036000291452", "6111245100135", "96385074"])("%s is valid", (code) => {
    expect(isValidGtin(code)).toBe(true);
  });

  it("rejects a wrong check digit, letters and odd lengths", () => {
    expect(isValidGtin("036000291453")).toBe(false);
    expect(isValidGtin("6111245100134")).toBe(false);
    expect(isValidGtin("61112451001A4")).toBe(false);
    expect(isValidGtin("12345")).toBe(false);
  });
});

describe("UPC-E ↔ UPC-A", () => {
  it.each([
    ["04252614", "042100005264"], // last digit 4
    ["01234572", "012345000072"], // last digit 5..9
    ["01234531", "012300000451"], // last digit 3
    ["01234505", "012000003455"], // last digit 0..2
  ])("%s expands to %s and back", (upcE, upcA) => {
    expect(isValidGtin(upcA)).toBe(true);
    expect(upcEToUpcA(upcE)).toBe(upcA);
    expect(upcAToUpcE(upcA)).toBe(upcE);
  });

  it("refuses codes that are not UPC-E / have no short form", () => {
    expect(upcEToUpcA("61234567")).toBeNull(); // EAN-8 range
    expect(upcEToUpcA("04252615")).toBeNull(); // wrong check digit
    expect(upcAToUpcE("036000291452")).toBeNull();
  });
});

describe("barcodeVariants", () => {
  it("starts with the scanned text", () => {
    expect(barcodeVariants("6111234567890")).toEqual(["6111234567890"]);
    expect(barcodeVariants("CM-42")).toEqual(["CM-42"]);
  });

  it("a 12-digit UPC-A also matches the 13-digit form an iPhone reads", () => {
    expect(barcodeVariants("036000291452")).toEqual(["036000291452", "0036000291452"]);
    expect(barcodeVariants("0036000291452")).toEqual(["0036000291452", "036000291452"]);
  });

  it("UPC-E and UPC-A forms find each other", () => {
    expect(barcodeVariants("04252614")).toEqual(["04252614", "042100005264", "0042100005264"]);
    expect(barcodeVariants("042100005264")).toEqual(["042100005264", "0042100005264", "04252614"]);
  });

  it("a GTIN-14 with leading zeros also matches its EAN-13 / UPC-A", () => {
    expect(barcodeVariants("00036000291452")).toEqual([
      "00036000291452",
      "0036000291452",
      "036000291452",
    ]);
  });

  it("an EAN-13 that does not start with 0 has no other form", () => {
    expect(barcodeVariants("6111245100135")).toEqual(["6111245100135"]);
  });
});

describe("pickByBarcode", () => {
  const rows = [
    { id: "a", barcode: "0036000291452" },
    { id: "b", barcode: "036000291452" },
    { id: "c", barcode: null },
  ];

  it("prefers the exact text", () => {
    expect(pickByBarcode("036000291452", rows)?.id).toBe("b");
    expect(pickByBarcode("0036000291452", rows)?.id).toBe("a");
  });

  it("falls back to an equivalent form", () => {
    expect(pickByBarcode("036000291452", [rows[0]])?.id).toBe("a");
  });

  it("never matches a prefix or an unrelated code", () => {
    expect(pickByBarcode("03600029145", rows)).toBeNull();
    expect(pickByBarcode("6111245100135", rows)).toBeNull();
  });

  it("sameBarcode is symmetric for equivalent forms", () => {
    expect(sameBarcode("036000291452", "0036000291452")).toBe(true);
    expect(sameBarcode("0036000291452", "036000291452")).toBe(true);
    expect(sameBarcode("6111245100135", "111245100135")).toBe(false);
  });
});
