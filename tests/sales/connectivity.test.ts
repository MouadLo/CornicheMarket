import { retryDelay } from "../../src/lib/sales/connectivity";

describe("retryDelay", () => {
  it("backs off from 15s to a 60s ceiling", () => {
    expect([0, 1, 2, 3, 4, 10].map(retryDelay)).toEqual([15000, 30000, 60000, 60000, 60000, 60000]);
  });
});
