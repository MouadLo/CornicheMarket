import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { ReceiptPanel } from "../../src/components/sell/ReceiptPanel";
import {
  fetchPrintJob,
  isStationOnline,
  requeuePrintJob,
  sendPrintJob,
} from "../../src/lib/print/queries";
import type { ReceiptModel } from "../../src/lib/sales/receipt";
import { allTexts, pressableByText } from "../sales/sellTestUtils";

const mockUuid = jest.fn();
jest.mock("expo-crypto", () => ({ randomUUID: () => mockUuid() }));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "ar" } }),
}));
jest.mock("../../src/lib/auth/AuthProvider", () => ({
  useAuth: () => ({ profile: { id: "u1", role: "cashier", full_name: "Sara" } }),
}));
jest.mock("../../src/lib/sales/printReceipt", () => ({
  canPrintReceipt: () => true,
  canShareReceipt: async () => false,
  printReceipt: jest.fn(),
  shareReceipt: jest.fn(),
}));
jest.mock("../../src/lib/print/queries", () => ({
  sendPrintJob: jest.fn(),
  fetchPrintJob: jest.fn(),
  requeuePrintJob: jest.fn(),
  isStationOnline: jest.fn(),
}));

const receipt: ReceiptModel = {
  shopName: "Corniche Market",
  receiptNumber: "ABCDEF12",
  occurredAt: "2026-11-17T10:00:00.000Z",
  cashierName: "Cashier from receipt",
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

let tree: ReactTestRenderer;
const sendMock = jest.mocked(sendPrintJob);
const fetchMock = jest.mocked(fetchPrintJob);
const requeueMock = jest.mocked(requeuePrintJob);
const onlineMock = jest.mocked(isStationOnline);

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockUuid.mockReturnValue("11111111-1111-1111-1111-111111111111");
  sendMock.mockResolvedValue(undefined);
  requeueMock.mockResolvedValue("pending");
  onlineMock.mockResolvedValue(true);
});
afterEach(() => {
  act(() => tree?.unmount());
  jest.useRealTimers();
});

async function open() {
  await act(async () => {
    tree = create(
      <ReceiptPanel receipt={receipt} timeZone="Africa/Casablanca" onClose={() => {}} />
    );
  });
}
const tick = (ms = 1000) =>
  act(async () => {
    jest.advanceTimersByTime(ms);
  });
const press = (label: string) =>
  act(async () => {
    pressableByText(tree.root, label).props.onPress();
  });
const isDisabled = (label: string) => pressableByText(tree.root, label).props.disabled === true;

describe("ReceiptPanel with the shared printer", () => {
  it("online: enabled button sends the receipt as data and follows it to printed", async () => {
    await open();
    expect(allTexts(tree.root)).toContain("receipt.stationReady");
    expect(isDisabled("receipt.printAtCounter")).toBe(false);

    fetchMock
      .mockResolvedValueOnce("pending")
      .mockResolvedValueOnce("printing")
      .mockResolvedValue("printed");
    await press("receipt.printAtCounter");

    expect(sendMock).toHaveBeenCalledTimes(1);
    const sent = sendMock.mock.calls[0][0];
    expect(sent).toEqual({
      id: "11111111-1111-1111-1111-111111111111",
      receipt,
      cashierLabel: "Sara",
      language: "ar",
      timeZone: "Africa/Casablanca",
    });
    expect(sent).not.toHaveProperty("html");
    expect(allTexts(tree.root)).toContain("receipt.printQueued");

    await tick();
    expect(allTexts(tree.root)).toContain("receipt.printQueued");
    await tick();
    expect(allTexts(tree.root)).toContain("receipt.printPrinting");
    await tick();
    expect(allTexts(tree.root)).toContain("receipt.printDone");

    // Another tap is a reprint: a new job, not a requeue of the printed one.
    expect(isDisabled("receipt.printAtCounter")).toBe(false);
    await press("receipt.printAtCounter");
    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(requeueMock).not.toHaveBeenCalled();
  });

  it("offline: the counter button is disabled and the status says so", async () => {
    onlineMock.mockResolvedValue(false);
    await open();
    expect(allTexts(tree.root)).toContain("receipt.stationUnavailable");
    expect(isDisabled("receipt.printAtCounter")).toBe(true);
    expect(sendMock).not.toHaveBeenCalled();
    // local printing is still there
    expect(isDisabled("receipt.print")).toBe(false);
  });

  it("re-checks the station every 10 seconds", async () => {
    onlineMock.mockResolvedValue(false);
    await open();
    expect(isDisabled("receipt.printAtCounter")).toBe(true);
    onlineMock.mockResolvedValue(true);
    await tick(10_000);
    expect(isDisabled("receipt.printAtCounter")).toBe(false);
    expect(onlineMock).toHaveBeenCalledTimes(2);
  });

  it("times out after 20 s with a retry that reuses the same job id", async () => {
    await open();
    fetchMock.mockResolvedValue("pending");
    await press("receipt.printAtCounter");
    for (let i = 0; i < 20; i++) await tick();
    expect(allTexts(tree.root)).toContain("receipt.printNoReply");

    fetchMock.mockResolvedValue("printed");
    await press("receipt.printRetry");
    expect(requeueMock).toHaveBeenCalledWith("11111111-1111-1111-1111-111111111111");
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(mockUuid).toHaveBeenCalledTimes(1);
    await tick();
    expect(allTexts(tree.root)).toContain("receipt.printDone");
  });

  it("a failed print offers a retry", async () => {
    await open();
    fetchMock.mockResolvedValue("failed");
    await press("receipt.printAtCounter");
    await tick();
    expect(allTexts(tree.root)).toContain("receipt.printStationFailed");
    fetchMock.mockResolvedValue("printed");
    await press("receipt.printRetry");
    expect(requeueMock).toHaveBeenCalledTimes(1);
    await tick();
    expect(allTexts(tree.root)).toContain("receipt.printDone");
  });

  it("a network error on send shows the offline message and a retry sends again with the same id", async () => {
    await open();
    sendMock.mockRejectedValueOnce(new Error("Network request failed"));
    await press("receipt.printAtCounter");
    expect(allTexts(tree.root)).toContain("receipt.printOffline");

    fetchMock.mockResolvedValue("printed");
    await press("receipt.printRetry");
    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(sendMock.mock.calls[1][0].id).toBe(sendMock.mock.calls[0][0].id);
    expect(requeueMock).not.toHaveBeenCalled();
    await tick();
    expect(allTexts(tree.root)).toContain("receipt.printDone");
  });

  it("stops polling when the panel unmounts", async () => {
    await open();
    fetchMock.mockResolvedValue("pending");
    await press("receipt.printAtCounter");
    await tick();
    const calls = fetchMock.mock.calls.length;
    act(() => tree.unmount());
    await tick(5000);
    expect(fetchMock.mock.calls.length).toBe(calls);
  });
});
