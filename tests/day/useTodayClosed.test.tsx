import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { useTodayClosed } from "../../src/lib/day/useTodayClosed";

const mockFetch = jest.fn();
jest.mock("@/src/lib/day/queries", () => ({ fetchTodayClosed: () => mockFetch() }));

let seen: boolean | null = null;
function Probe() {
  seen = useTodayClosed();
  return null;
}

let tree: ReactTestRenderer | null = null;
afterEach(() => act(() => tree?.unmount()));

it("is false until the server says the day is closed, then true", async () => {
  mockFetch.mockResolvedValue(true);
  await act(async () => {
    tree = create(<Probe />);
  });
  expect(seen).toBe(true);
});

it("stays false when the day is open", async () => {
  mockFetch.mockResolvedValue(false);
  await act(async () => {
    tree = create(<Probe />);
  });
  expect(seen).toBe(false);
});
