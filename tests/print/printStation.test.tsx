import React from "react";
import { Platform } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import PrintStationScreen from "../../app/(app)/sell/print-station";
import type { PrintJob } from "../../src/lib/print/jobs";
import {
  cancelPrintJob,
  claimNextPrintJob,
  claimPrintJob,
  fetchStationJobs,
  finishPrintJob,
} from "../../src/lib/print/queries";
import { createSerialRunner, processJob, stationStep } from "../../src/lib/print/station";
import { printReceipt } from "../../src/lib/sales/printReceipt";
import { allTexts, pressableByText } from "../sales/sellTestUtils";

jest.mock("react-i18next", () => {
  const fixed = (lng: string) => (key: string) => `${lng}:${key}`;
  return {
    useTranslation: () => ({
      t: (key: string) => key,
      i18n: { language: "fr", getFixedT: fixed },
    }),
  };
});
jest.mock("../../src/lib/sales/printReceipt", () => ({
  canPrintReceipt: () => true,
  canShareReceipt: async () => false,
  printReceipt: jest.fn(),
  shareReceipt: jest.fn(),
}));
jest.mock("../../src/lib/print/queries", () => ({
  claimNextPrintJob: jest.fn(),
  claimPrintJob: jest.fn(),
  finishPrintJob: jest.fn(),
  cancelPrintJob: jest.fn(),
  fetchStationJobs: jest.fn(),
}));
jest.mock("../../src/lib/auth/AuthProvider", () => ({ useAuth: () => ({ profile: null }) }));

const receipt = {
  shopName: "Corniche Market",
  receiptNumber: "ABCDEF12",
  occurredAt: "2026-11-17T10:00:00.000Z",
  cashierName: null,
  lines: [
    {
      name: "Milk",
      quantity: 1,
      unit: null,
      unitPriceCents: 700,
      discountCents: 0,
      totalCents: 700,
    },
  ],
  subtotalCents: 700,
  discountCents: 0,
  totalCents: 700,
  paymentMethod: "cash",
  customerName: null,
  cashReceivedCents: null,
  changeCents: null,
};

const job = (patch: Partial<PrintJob> = {}): PrintJob => ({
  id: "job-1",
  created_by: "u1",
  cashier_label: "Sara <b>",
  receipt,
  language: "en",
  time_zone: "UTC",
  status: "printing",
  created_at: new Date().toISOString(),
  claimed_at: null,
  printed_at: null,
  error: null,
  attempts: 1,
  ...patch,
});

const claimNext = jest.mocked(claimNextPrintJob);
const claim = jest.mocked(claimPrintJob);
const finish = jest.mocked(finishPrintJob);
const cancel = jest.mocked(cancelPrintJob);
const list = jest.mocked(fetchStationJobs);
const print = jest.mocked(printReceipt);

beforeEach(() => {
  jest.clearAllMocks();
  claimNext.mockResolvedValue(null);
  finish.mockResolvedValue(undefined);
  cancel.mockResolvedValue(undefined);
  list.mockResolvedValue([]);
  print.mockResolvedValue(undefined);
});

const render = (_model: unknown, j: PrintJob) => `<html>${j.cashier_label}</html>`;

describe("station step", () => {
  it("does nothing when there is no job", async () => {
    const result = await stationStep({ claim: claimNext, finish, print, render });
    expect(result).toEqual({ kind: "idle" });
    expect(print).not.toHaveBeenCalled();
  });

  it("prints a claimed job and finishes it ok", async () => {
    claimNext.mockResolvedValueOnce(job());
    const result = await stationStep({ claim: claimNext, finish, print, render });
    expect(result.kind).toBe("printed");
    expect(print).toHaveBeenCalledWith("<html>Sara <b></html>");
    expect(finish).toHaveBeenCalledWith("job-1", true);
  });

  it("finishes an invalid receipt as failed without printing", async () => {
    claimNext.mockResolvedValueOnce(job({ receipt: { html: "<script>" } }));
    const result = await stationStep({ claim: claimNext, finish, print, render });
    expect(result).toMatchObject({ kind: "failed", error: "invalid receipt" });
    expect(print).not.toHaveBeenCalled();
    expect(finish).toHaveBeenCalledWith("job-1", false, "invalid receipt");
  });

  it("finishes as failed when printing throws", async () => {
    claimNext.mockResolvedValueOnce(job());
    print.mockRejectedValueOnce(new Error("no printer"));
    const result = await stationStep({ claim: claimNext, finish, print, render });
    expect(result).toMatchObject({ kind: "failed", error: "no printer" });
    expect(finish).toHaveBeenCalledWith("job-1", false, "no printer");
  });

  it("lets a network failure while reporting reach the caller", async () => {
    finish.mockRejectedValueOnce(new Error("Network request failed"));
    await expect(processJob(job(), { finish, print, render })).rejects.toThrow("Network");
  });
});

describe("one at a time", () => {
  it("runs tasks strictly in sequence", async () => {
    const runner = createSerialRunner();
    const events: string[] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const first = runner.run(async () => {
      events.push("a start");
      await gate;
      events.push("a end");
    });
    const second = runner.run(async () => {
      events.push("b start");
    });
    await Promise.resolve();
    expect(events).toEqual(["a start"]);
    expect(runner.busy).toBe(true);
    release();
    await Promise.all([first, second]);
    expect(events).toEqual(["a start", "a end", "b start"]);
    expect(runner.busy).toBe(false);
  });

  it("keeps going after a task fails", async () => {
    const runner = createSerialRunner();
    await expect(runner.run(async () => Promise.reject(new Error("x")))).rejects.toThrow("x");
    await expect(runner.run(async () => 5)).resolves.toBe(5);
  });
});

describe("print station screen (web)", () => {
  const original = Platform.OS;
  let tree: ReactTestRenderer;
  beforeEach(() => {
    jest.useFakeTimers();
    Object.defineProperty(Platform, "OS", { value: "web", configurable: true });
  });
  afterEach(() => {
    act(() => tree?.unmount());
    jest.useRealTimers();
    Object.defineProperty(Platform, "OS", { value: original, configurable: true });
  });

  const mount = async () => {
    await act(async () => {
      tree = create(<PrintStationScreen />);
    });
  };
  const tick = (ms: number) =>
    act(async () => {
      jest.advanceTimersByTime(ms);
    });

  it("prints a claimed job with the cashier banner in the job's language, then finishes it", async () => {
    claimNext.mockResolvedValueOnce(job({ language: "ar", cashier_label: "Sara <b>" }));
    await mount();
    await tick(0);
    expect(print).toHaveBeenCalledTimes(1);
    const html = print.mock.calls[0][0];
    expect(html).toContain('<div class="cashier-tag">');
    expect(html).toContain("Sara &lt;b&gt;");
    expect(html).toContain('lang="ar"');
    expect(html).toContain("ar:receipt.thanks");
    expect(html).toContain("@page { size: 80mm auto; margin: 0; }");
    expect(finish).toHaveBeenCalledWith("job-1", true);
  });

  it("prints the after-returns footer of an updated receipt", async () => {
    const updated = {
      ...receipt,
      afterReturns: {
        originalTotalCents: 1900,
        refundedCents: 1200,
        refundMethods: ["cash"],
        lastReturnAt: "2026-11-18T09:30:00.000Z",
      },
    };
    claimNext.mockResolvedValueOnce(job({ language: "fr", receipt: updated }));
    await mount();
    await tick(0);
    expect(print).toHaveBeenCalledTimes(1);
    const html = print.mock.calls[0][0];
    expect(html).toContain("fr:receipt.updatedAfterReturn");
    expect(html).toContain("fr:receipt.originalTotal");
    expect(html).toContain("19.00");
    expect(html).toContain("-12.00");
    expect(finish).toHaveBeenCalledWith("job-1", true);
  });

  it("does not overlap ticks: the next claim waits for the print to end", async () => {
    let endPrint: () => void = () => {};
    print.mockImplementationOnce(() => new Promise<void>((resolve) => (endPrint = resolve)));
    claimNext.mockResolvedValueOnce(job());
    await mount();
    await tick(0);
    expect(print).toHaveBeenCalledTimes(1);
    await tick(10_000);
    expect(claimNext).toHaveBeenCalledTimes(1);
    expect(finish).not.toHaveBeenCalled();
    await act(async () => endPrint());
    await tick(1500);
    expect(finish).toHaveBeenCalledWith("job-1", true);
    expect(claimNext.mock.calls.length).toBeGreaterThan(1);
  });

  it("keeps looping after a lost connection and says so", async () => {
    claimNext.mockRejectedValueOnce(new Error("Network request failed"));
    await mount();
    await tick(0);
    expect(allTexts(tree.root)).toContain("printStation.connectionLost");
    await tick(1500);
    expect(claimNext).toHaveBeenCalledTimes(2);
    expect(allTexts(tree.root)).not.toContain("printStation.connectionLost");
  });

  it("offers Imprimer and Ignorer for a failed job and prints it by hand", async () => {
    const failed = job({ status: "failed", error: "paper" });
    list.mockResolvedValue([failed]);
    claim.mockResolvedValue(job());
    await mount();
    await tick(0);
    await act(async () => pressableByText(tree.root, "printStation.print").props.onPress());
    expect(claim).toHaveBeenCalledWith("job-1");
    expect(print).toHaveBeenCalledTimes(1);
    expect(finish).toHaveBeenCalledWith("job-1", true);
    await act(async () => pressableByText(tree.root, "printStation.ignore").props.onPress());
    expect(cancel).toHaveBeenCalledWith("job-1");
  });

  it("prints a test receipt locally without touching the database", async () => {
    await mount();
    await act(async () => pressableByText(tree.root, "printStation.testButton").props.onPress());
    expect(print).toHaveBeenCalledTimes(1);
    expect(print.mock.calls[0][0]).toContain("TEST");
    expect(finish).not.toHaveBeenCalled();
  });
});
