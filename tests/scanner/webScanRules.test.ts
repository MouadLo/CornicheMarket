import {
  confirmRead,
  createScanFilter,
  LEAVE_FRAME_MS,
  passFrameGate,
} from "../../src/lib/scanner/webScanRules";
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

describe("passFrameGate (leave the frame before the same code again)", () => {
  it("accepts the first sighting", () => {
    expect(passFrameGate(null, CODE, 0).accept).toBe(true);
  });
  it("refuses the same code while it stays in view", () => {
    const first = passFrameGate(null, CODE, 0);
    expect(passFrameGate(first.gate, CODE, 200).accept).toBe(false);
  });
  it("accepts it again once it was unseen for the leave time", () => {
    const first = passFrameGate(null, CODE, 0);
    expect(passFrameGate(first.gate, CODE, LEAVE_FRAME_MS).accept).toBe(true);
  });
  it("a different code is accepted at once", () => {
    const first = passFrameGate(null, CODE, 0);
    expect(passFrameGate(first.gate, OTHER, 10).accept).toBe(true);
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
    const out = feed(filter, [CODE, CODE, ...Array(6).fill(null), CODE, CODE]); // 6 empty = 900 ms
    expect(out.filter(Boolean)).toEqual([CODE, CODE]);
  });

  it("a flicker shorter than the leave time does not count as leaving", () => {
    const filter = createScanFilter();
    const out = feed(filter, [CODE, CODE, null, null, CODE, CODE, CODE]);
    expect(out.filter(Boolean)).toEqual([CODE]);
  });

  it("is independent of shouldAcceptScan, which is left as it was", () => {
    expect(shouldAcceptScan({ code: CODE, at: 0 }, CODE, 999)).toBe(false);
    expect(shouldAcceptScan({ code: CODE, at: 0 }, CODE, 1000)).toBe(true);
  });
});
