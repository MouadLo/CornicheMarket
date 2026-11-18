import { confirmRead, createScanFilter, LEAVE_FRAME_MS } from "../../src/lib/scanner/webScanRules";
import { shouldAcceptScan } from "../../src/lib/sales/scanRules";

const CODE = "6111234567890";
const OTHER = "6119876543210";

describe("confirmRead (two consecutive reads)", () => {
  it("one read is not enough", () => {
    expect(confirmRead(null, CODE)).toEqual({ previous: CODE, confirmed: false });
  });
  it("the same value twice in a row is confirmed", () => {
    expect(confirmRead(CODE, CODE).confirmed).toBe(true);
  });
  it("two different values are not", () => {
    expect(confirmRead(CODE, OTHER)).toEqual({ previous: OTHER, confirmed: false });
  });
  it("a decode that finds nothing resets the run", () => {
    expect(confirmRead(CODE, null)).toEqual({ previous: null, confirmed: false });
  });
});

describe("createScanFilter", () => {
  const feed = (
    filter: ReturnType<typeof createScanFilter>,
    codes: (string | null)[],
    step = 150
  ) => codes.map((c, i) => filter.push(c, i * step));

  it("a product held in front of the camera is accepted once, however long", () => {
    const filter = createScanFilter();
    const out = feed(filter, Array(40).fill(CODE)); // 6 seconds in view
    expect(out.filter(Boolean)).toEqual([CODE]);
  });

  it("a misread single frame is ignored", () => {
    expect(feed(createScanFilter(), [CODE, null, null]).filter(Boolean)).toEqual([]);
    expect(feed(createScanFilter(), [CODE, OTHER, CODE]).filter(Boolean)).toEqual([]);
  });

  it("two identical products, one moved out and the next brought in, add two", () => {
    const filter = createScanFilter();
    const out = feed(filter, [CODE, CODE, ...Array(11).fill(null), CODE, CODE]); // 11 empty = 1650 ms
    expect(out.filter(Boolean)).toEqual([CODE, CODE]);
  });

  it("a flicker shorter than the leave time does not count as leaving", () => {
    const filter = createScanFilter();
    const out = feed(filter, [CODE, CODE, null, null, CODE, CODE, CODE]);
    expect(out.filter(Boolean)).toEqual([CODE]);
  });

  it("a held product read only every other frame is still accepted once", () => {
    const flaky = Array.from({ length: 60 }, (_, i) => (i < 2 || i % 2 === 0 ? CODE : null));
    expect(feed(createScanFilter(), flaky).filter(Boolean)).toEqual([CODE]);
  });

  it("two barcodes in view do not re-add each other", () => {
    const both = Array.from({ length: 60 }, (_, i) => (Math.floor(i / 2) % 2 === 0 ? CODE : OTHER));
    expect(feed(createScanFilter(), both).filter(Boolean)).toEqual([CODE, OTHER]);
  });

  it("the leave time is measured from the last sighting", () => {
    const filter = createScanFilter();
    filter.push(CODE, 0);
    expect(filter.push(CODE, 150)).toBe(CODE);
    filter.push(CODE, 150 + LEAVE_FRAME_MS - 1);
    expect(filter.push(CODE, 150 + 2 * LEAVE_FRAME_MS - 2)).toBeNull();
  });

  it("is independent of shouldAcceptScan, which is left as it was", () => {
    expect(shouldAcceptScan({ code: CODE, at: 0 }, CODE, 999)).toBe(false);
    expect(shouldAcceptScan({ code: CODE, at: 0 }, CODE, 1000)).toBe(true);
  });
});
