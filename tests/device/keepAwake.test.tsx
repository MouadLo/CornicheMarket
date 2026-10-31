/**
 * The counter tablet must not sleep between customers while Sell is in use,
 * and must sleep normally elsewhere. Failure to get a wake lock must never
 * affect selling.
 */
import React from "react";
import { act, create } from "react-test-renderer";

import { useKeepAwakeWhileFocused } from "../../src/lib/device/useKeepAwakeWhileFocused";

const mockActivate = jest.fn(async (..._args: unknown[]) => {});
const mockDeactivate = jest.fn(async (..._args: unknown[]) => {});

jest.mock("expo-keep-awake", () => ({
  activateKeepAwakeAsync: (...args: unknown[]) => mockActivate(...args),
  deactivateKeepAwake: (...args: unknown[]) => mockDeactivate(...args),
}));
// Focus is simulated as "focused while mounted".
jest.mock("expo-router", () => ({
  useFocusEffect: (effect: () => void | (() => void)) => {
    // eslint-disable-next-line react-hooks/exhaustive-deps
    require("react").useEffect(effect, [effect]);
  },
}));

function Probe() {
  useKeepAwakeWhileFocused("sell");
  return null;
}

beforeEach(() => {
  mockActivate.mockClear();
  mockDeactivate.mockClear();
});

describe("useKeepAwakeWhileFocused", () => {
  it("keeps the screen awake while the section is shown, tagged so it can be released", () => {
    act(() => {
      create(<Probe />);
    });
    expect(mockActivate).toHaveBeenCalledWith("sell");
    expect(mockDeactivate).not.toHaveBeenCalled();
  });

  it("releases the wake lock when the cashier leaves the section", () => {
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<Probe />);
    });
    act(() => tree.unmount());
    expect(mockDeactivate).toHaveBeenCalledWith("sell");
  });

  it("swallows a refused wake lock instead of breaking the screen", async () => {
    mockActivate.mockRejectedValueOnce(new Error("NotAllowedError"));
    mockDeactivate.mockRejectedValueOnce(new Error("not active"));
    let tree!: ReturnType<typeof create>;
    expect(() => {
      act(() => {
        tree = create(<Probe />);
      });
    }).not.toThrow();
    await act(async () => {});
    act(() => tree.unmount());
    await act(async () => {});
  });
});
