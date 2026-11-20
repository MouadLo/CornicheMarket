import {
  CONFIRM_WINDOW_MS,
  LEAVE_FRAME_MS,
  createScanFilter,
  plausibleRead,
  type ScanRead,
} from "../../src/lib/scanner/scanFilter";

const EAN = "6111245100135";
const OTHER = "6111234567895";
const EAN8 = "96385074";
const ean = (text = EAN): ScanRead => ({ text, format: "ean13" });

// Feeds one read every `step` ms and returns what each push gave back.
function feed(filter: ReturnType<typeof createScanFilter>, reads: (ScanRead | null)[], step = 100) {
  return reads.map((read, index) => filter.push(read, index * step));
}

describe("plausibleRead", () => {
  it("checks the digits of EAN/UPC reads", () => {
    expect(plausibleRead(EAN, "ean13")).toBe(true);
    expect(plausibleRead("6111245100134", "ean13")).toBe(false);
    expect(plausibleRead("036000291452", "upca")).toBe(true);
    expect(plausibleRead("0036000291452", "upca")).toBe(true);
    expect(plausibleRead(EAN8, "ean8")).toBe(true);
    expect(plausibleRead("96385075", "ean8")).toBe(false);
    expect(plausibleRead("04252614", "upce")).toBe(true);
    expect(plausibleRead("04252615", "upce")).toBe(false);
    expect(plausibleRead("CM-42", "code128")).toBe(true);
  });
});

describe("createScanFilter", () => {
  it("an EAN-13 is accepted on its first read", () => {
    expect(createScanFilter().push(ean(), 0)).toBe(EAN);
  });

  it("a camera that reads a held code only every other frame still scans it once", () => {
    const flaky = [ean(), null, ean(), null, null, ean(), null, ean()];
    expect(feed(createScanFilter(), flaky).filter(Boolean)).toEqual([EAN]);
  });

  it("a code left in view is one item, however long it stays", () => {
    const reads = Array.from({ length: 60 }, () => ean()); // 6 seconds
    expect(feed(createScanFilter(), reads).filter(Boolean)).toEqual([EAN]);
  });

  it("the same code after it left the frame is a second item", () => {
    const filter = createScanFilter();
    expect(filter.push(ean(), 0)).toBe(EAN);
    expect(filter.push(ean(), LEAVE_FRAME_MS - 1)).toBeNull(); // still held, refreshed
    expect(filter.push(null, 2 * LEAVE_FRAME_MS - 1)).toBeNull();
    expect(filter.push(ean(), 2 * LEAVE_FRAME_MS - 1)).toBe(EAN);
  });

  it("two codes in view do not re-add each other", () => {
    const both = [ean(), ean(OTHER), ean(), ean(OTHER), ean(), ean(OTHER)];
    expect(feed(createScanFilter(), both).filter(Boolean)).toEqual([EAN, OTHER]);
  });

  it("a damaged read (bad check digit) is ignored", () => {
    expect(createScanFilter().push(ean("6111245100134"), 0)).toBeNull();
  });

  it("EAN-8, UPC-E and Code 39 need the same text twice, not necessarily in a row", () => {
    const filter = createScanFilter();
    expect(filter.push({ text: EAN8, format: "ean8" }, 0)).toBeNull();
    expect(filter.push(null, 100)).toBeNull();
    expect(filter.push({ text: EAN8, format: "ean8" }, 200)).toBe(EAN8);

    const code39 = createScanFilter();
    expect(code39.push({ text: "CM42", format: "code39" }, 0)).toBeNull();
    expect(code39.push({ text: "CM42", format: "code39" }, 300)).toBe("CM42");
  });

  it("a lone short-code sighting expires", () => {
    const filter = createScanFilter();
    expect(filter.push({ text: EAN8, format: "ean8" }, 0)).toBeNull();
    expect(filter.push({ text: EAN8, format: "ean8" }, CONFIRM_WINDOW_MS + 1)).toBeNull();
    expect(filter.push({ text: EAN8, format: "ean8" }, CONFIRM_WINDOW_MS + 200)).toBe(EAN8);
  });

  it("hands over the cleaned code", () => {
    expect(createScanFilter().push({ text: ` ${EAN}\r`, format: "ean13" }, 0)).toBe(EAN);
  });

  it("reset forgets held codes", () => {
    const filter = createScanFilter();
    filter.push(ean(), 0);
    filter.reset();
    expect(filter.push(ean(), 10)).toBe(EAN);
  });

  it("the leave time can be set", () => {
    const filter = createScanFilter({ leaveMs: 300 });
    expect(filter.push(ean(), 0)).toBe(EAN);
    expect(filter.push(ean(), 300)).toBe(EAN);
  });
});
