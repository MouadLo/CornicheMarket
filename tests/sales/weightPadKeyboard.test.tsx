import React from "react";
import { Platform } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { WeightPad } from "../../src/components/sell/WeightPad";

jest.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

type Handler = (event: Record<string, unknown>) => void;
let handlers: Handler[] = [];
let captureFlags: unknown[] = [];
let clock = 0;

const onConfirm = jest.fn();
const onCancel = jest.fn();
let tree: ReactTestRenderer;

// Sends a key the way a browser would, `gap` ms after the previous one.
function press(key: string, gap = 200, extra: Record<string, unknown> = {}) {
  clock += gap;
  const event = {
    key,
    timeStamp: clock,
    repeat: false,
    preventDefault: jest.fn(),
    stopPropagation: jest.fn(),
    ...extra,
  };
  act(() => handlers.forEach((handler) => handler(event)));
  return event;
}

const entry = () => tree.root.findByProps({ testID: "weight-entry" }).props.children;

function mount() {
  act(() => {
    tree = create(
      <WeightPad
        productName="Courgettes"
        unitPriceCents={900}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );
  });
}

beforeEach(() => {
  handlers = [];
  captureFlags = [];
  clock = 10_000;
  onConfirm.mockClear();
  onCancel.mockClear();
  jest.replaceProperty(Platform, "OS", "web");
  (global as unknown as { document: unknown }).document = {
    addEventListener: (_type: string, handler: Handler, capture?: unknown) => {
      handlers.push(handler);
      captureFlags.push(capture);
    },
    removeEventListener: (_type: string, handler: Handler) => {
      handlers = handlers.filter((existing) => existing !== handler);
    },
  };
});
afterEach(() => {
  act(() => tree?.unmount());
  jest.restoreAllMocks();
  delete (global as unknown as { document?: unknown }).document;
});

it("types a weight with the keyboard and Enter adds it: 0 . 5 Enter -> 0.5 kg", () => {
  mount();
  press("0");
  press(".");
  press("5");
  expect(entry()).toBe("0.5");
  press("Enter");
  expect(onConfirm).toHaveBeenCalledWith(0.5);
});

it("accepts a comma as the decimal separator and keeps three decimals", () => {
  mount();
  for (const key of ["0", ",", "1", "2", "5", "9"]) press(key);
  expect(entry()).toBe("0.125");
  press("Enter");
  expect(onConfirm).toHaveBeenCalledWith(0.125);
});

it("Backspace removes the last character", () => {
  mount();
  press("1");
  press(".");
  press("5");
  press("Backspace");
  expect(entry()).toBe("1.");
});

it("Enter does nothing until the weight is above zero", () => {
  mount();
  press("Enter");
  press("0");
  press("Enter");
  expect(onConfirm).not.toHaveBeenCalled();
});

it("Escape cancels", () => {
  mount();
  press("Escape");
  expect(onCancel).toHaveBeenCalledTimes(1);
});

it("ignores a scanner burst: keys a few ms apart (barcode digits and its Enter)", () => {
  mount();
  press("6", 500);
  for (const key of ["1", "1", "2", "0", "0", "0"]) press(key, 4);
  press("Enter", 4);
  expect(entry()).toBe("6");
  expect(onConfirm).not.toHaveBeenCalled();
});

it("holding Backspace still repeats quickly (scanners never send it)", () => {
  mount();
  press("1", 300);
  press("2", 300);
  press("Backspace", 300);
  press("Backspace", 30, { repeat: true });
  expect(entry()).toBe("0");
});

it("leaves other keys and shortcuts alone (no preventDefault, no change)", () => {
  mount();
  const letter = press("a");
  const shortcut = press("5", 200, { ctrlKey: true });
  expect(entry()).toBe("0");
  expect(letter.preventDefault).not.toHaveBeenCalled();
  expect(shortcut.preventDefault).not.toHaveBeenCalled();
});

it("claims the keys it handles so the page doesn't also act on them", () => {
  mount();
  expect(press("5").preventDefault).toHaveBeenCalled();
  expect(press("Backspace").preventDefault).toHaveBeenCalled();
});

it("stops the event before a focused keypad button can handle Enter itself", () => {
  mount();
  const enter = press("Enter");
  expect(enter.stopPropagation).toHaveBeenCalled();
  // And it listens in the capture phase, ahead of the buttons.
  expect(captureFlags).toEqual([true]);
});

it("removes its listener when the pad closes", () => {
  mount();
  expect(handlers).toHaveLength(1);
  act(() => tree.unmount());
  expect(handlers).toHaveLength(0);
});

it("does nothing on native (no document, no listener)", () => {
  jest.replaceProperty(Platform, "OS", "ios");
  mount();
  expect(handlers).toHaveLength(0);
});
