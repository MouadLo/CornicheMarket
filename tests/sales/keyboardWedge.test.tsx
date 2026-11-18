import React from "react";
import { Platform } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { useKeyboardWedge } from "../../src/lib/sales/useKeyboardWedge";

type Handler = (event: Record<string, unknown>) => void;
let registered: { handler: Handler; capture: unknown }[] = [];
let clock = 0;
let tree: ReactTestRenderer;
const onScan = jest.fn();

function Harness({ guard }: { guard: boolean }) {
  useKeyboardWedge(onScan, true, guard);
  return null;
}

// A focused text field the way a browser holds one.
function makeField(value = "") {
  const field = { tagName: "INPUT", value, dispatchEvent: jest.fn() };
  return field;
}

function key(k: string, target: unknown, gap: number) {
  clock += gap;
  jest.spyOn(Date, "now").mockReturnValue(clock);
  const event = {
    key: k,
    target,
    repeat: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    defaultPrevented: false,
    preventDefault: jest.fn(),
    stopPropagation: jest.fn(),
  };
  act(() => registered.forEach((r) => r.handler(event)));
  // The browser types the key into the field unless something stopped it.
  const stopped = event.preventDefault.mock.calls.length > 0;
  if (!stopped && k.length === 1 && target) (target as { value: string }).value += k;
  return event;
}

function scan(code: string, target: unknown) {
  const events = [...code].map((c, i) => key(c, target, i === 0 ? 300 : 8));
  events.push(key("Enter", target, 8));
  return events;
}

beforeEach(() => {
  registered = [];
  clock = 100_000;
  onScan.mockClear();
  jest.replaceProperty(Platform, "OS", "web");
  (global as unknown as { document: unknown }).document = {
    addEventListener: (_t: string, handler: Handler, capture?: unknown) =>
      registered.push({ handler, capture }),
    removeEventListener: (_t: string, handler: Handler) => {
      registered = registered.filter((r) => r.handler !== handler);
    },
  };
});
afterEach(() => {
  act(() => tree?.unmount());
  jest.restoreAllMocks();
  delete (global as unknown as { document?: unknown }).document;
});

const mount = (guard: boolean) => act(() => void (tree = create(<Harness guard={guard} />)));

describe("guarded (stock count): a scan never lands in a field", () => {
  it("restores the field's previous value and swallows the rest of the scan and its Enter", () => {
    mount(true);
    const field = makeField("5");
    const events = scan("6111000000000", field);
    expect(onScan).toHaveBeenCalledWith("6111000000000");
    expect(field.value).toBe("5");
    expect(field.dispatchEvent).toHaveBeenCalled();
    const typedKeys = events.slice(1, -1);
    expect(typedKeys.every((e) => e.preventDefault.mock.calls.length === 1)).toBe(true);
    const enter = events[events.length - 1];
    expect(enter.preventDefault).toHaveBeenCalled();
    expect(enter.stopPropagation).toHaveBeenCalled();
  });

  it("listens in the capture phase, before the field's own handlers", () => {
    mount(true);
    expect(registered[0].capture).toBe(true);
  });

  it("an empty field is put back to empty", () => {
    mount(true);
    const field = makeField("");
    scan("6111000000000", field);
    expect(field.value).toBe("");
  });

  it("ordinary slow typing and its Enter are left alone", () => {
    mount(true);
    const field = makeField("");
    const events = [key("1", field, 400), key("2", field, 400), key("Enter", field, 400)];
    expect(field.value).toBe("12");
    expect(events.every((e) => e.preventDefault.mock.calls.length === 0)).toBe(true);
    expect(onScan).not.toHaveBeenCalled();
  });

  it("a held-down key is typing, not a scan", () => {
    mount(true);
    const field = makeField("");
    for (let i = 0; i < 6; i++) {
      clock += 30;
      jest.spyOn(Date, "now").mockReturnValue(clock);
      const event = {
        key: "0",
        target: field,
        repeat: i > 0,
        preventDefault: jest.fn(),
        stopPropagation: jest.fn(),
      };
      act(() => registered.forEach((r) => r.handler(event)));
      if (!event.preventDefault.mock.calls.length) field.value += "0";
    }
    expect(field.value).toBe("000000");
  });
});

describe("unguarded (Sell): unchanged", () => {
  it("lets the scan through the field, reports it, and never restores or stops it", () => {
    mount(false);
    const field = makeField("");
    const events = scan("6111000000000", field);
    expect(onScan).toHaveBeenCalledWith("6111000000000");
    expect(field.value).toBe("6111000000000");
    expect(field.dispatchEvent).not.toHaveBeenCalled();
    expect(events.slice(0, -1).every((e) => e.preventDefault.mock.calls.length === 0)).toBe(true);
    expect(events.every((e) => e.stopPropagation.mock.calls.length === 0)).toBe(true);
    expect(registered[0].capture).toBe(false);
  });
});
