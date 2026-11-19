import { Platform } from "react-native";

import {
  canPrintReceipt,
  canShareReceipt,
  printReceipt,
  shareReceipt,
} from "../../src/lib/sales/printReceipt";

const mockPrintAsync = jest.fn();
const mockPrintToFile = jest.fn();
const mockShareAsync = jest.fn();
const mockIsAvailable = jest.fn();
jest.mock("expo-print", () => ({
  printAsync: (...a: unknown[]) => mockPrintAsync(...a),
  printToFileAsync: (...a: unknown[]) => mockPrintToFile(...a),
}));
jest.mock("expo-sharing", () => ({
  shareAsync: (...a: unknown[]) => mockShareAsync(...a),
  isAvailableAsync: () => mockIsAvailable(),
}));

const input = { html: "<p>r</p>", text: "r", title: "T" };

function setOS(os: string) {
  Object.defineProperty(Platform, "OS", { get: () => os, configurable: true });
}
afterEach(() => {
  setOS("ios");
  jest.clearAllMocks();
  delete (globalThis as { document?: unknown }).document;
  delete (globalThis as { navigator?: unknown }).navigator;
});

describe("native", () => {
  beforeEach(() => setOS("ios"));

  it("prints the html with expo-print", async () => {
    await printReceipt("<p>r</p>");
    expect(mockPrintAsync).toHaveBeenCalledWith({ html: "<p>r</p>" });
  });

  it("shares a PDF file through the share sheet", async () => {
    mockPrintToFile.mockResolvedValue({ uri: "file:///r.pdf" });
    expect(await shareReceipt(input)).toBe("shared");
    expect(mockShareAsync).toHaveBeenCalledWith(
      "file:///r.pdf",
      expect.objectContaining({ mimeType: "application/pdf" })
    );
  });

  it("treats a cancelled share as not an error, and a real failure as one", async () => {
    mockPrintToFile.mockResolvedValue({ uri: "file:///r.pdf" });
    mockShareAsync.mockRejectedValueOnce(Object.assign(new Error("x"), { name: "AbortError" }));
    expect(await shareReceipt(input)).toBe("cancelled");
    mockShareAsync.mockRejectedValueOnce(new Error("boom"));
    await expect(shareReceipt(input)).rejects.toThrow("boom");
  });

  it("reports whether sharing is available", async () => {
    mockIsAvailable.mockResolvedValueOnce(true);
    expect(await canShareReceipt()).toBe(true);
    mockIsAvailable.mockRejectedValueOnce(new Error("x"));
    expect(await canShareReceipt()).toBe(false);
  });
});

describe("web", () => {
  beforeEach(() => setOS("web"));

  it("prints through a hidden iframe and removes it afterwards", async () => {
    jest.useFakeTimers();
    const listeners: Record<string, () => void> = {};
    const print = jest.fn();
    const frame: Record<string, unknown> = {
      style: {},
      setAttribute: jest.fn(),
      remove: jest.fn(),
      contentWindow: {
        focus: jest.fn(),
        print,
        addEventListener: (name: string, fn: () => void) => (listeners[name] = fn),
      },
    };
    const append = jest.fn();
    (globalThis as { document?: unknown }).document = {
      createElement: () => frame,
      body: { appendChild: append },
    };
    const done = printReceipt("<p>r</p>");
    expect(append).toHaveBeenCalledWith(frame);
    expect(frame.srcdoc).toBe("<p>r</p>");
    (frame.onload as () => void)();
    await done;
    expect(print).toHaveBeenCalled();
    expect(mockPrintAsync).not.toHaveBeenCalled();
    listeners.afterprint();
    expect(frame.remove).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });

  it("shares plain text only when navigator.share exists", async () => {
    expect(await canShareReceipt()).toBe(false);
    const share = jest.fn().mockResolvedValue(undefined);
    (globalThis as { navigator?: unknown }).navigator = { share };
    expect(await canShareReceipt()).toBe(true);
    expect(await shareReceipt(input)).toBe("shared");
    expect(share).toHaveBeenCalledWith({ title: "T", text: "r" });
    share.mockRejectedValueOnce(Object.assign(new Error("x"), { name: "AbortError" }));
    expect(await shareReceipt(input)).toBe("cancelled");
    share.mockRejectedValueOnce(new Error("nope"));
    await expect(shareReceipt(input)).rejects.toThrow("nope");
  });
});

describe("canPrintReceipt", () => {
  const browser = (userAgent: string, maxTouchPoints = 0) => {
    setOS("web");
    Object.defineProperty(globalThis, "navigator", {
      value: { userAgent, maxTouchPoints },
      configurable: true,
    });
  };

  it("offers printing on native apps and desktop or Android browsers", () => {
    setOS("android");
    expect(canPrintReceipt()).toBe(true);
    browser("Mozilla/5.0 (Windows NT 10.0) Chrome/130");
    expect(canPrintReceipt()).toBe(true);
    browser("Mozilla/5.0 (Linux; Android 14) Chrome/130", 5);
    expect(canPrintReceipt()).toBe(true);
    browser("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605");
    expect(canPrintReceipt()).toBe(true);
  });

  it("leaves iPhone and iPad browsers to Share", () => {
    browser("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604");
    expect(canPrintReceipt()).toBe(false);
    browser("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605", 5);
    expect(canPrintReceipt()).toBe(false);
  });
});
