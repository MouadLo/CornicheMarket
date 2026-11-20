jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock")
);

// The basket store is module state and saves to device storage: each test
// starts with an empty basket and nothing saved. Loaded lazily so a test
// file's own storage mock still wins.
afterEach(async () => {
  const { __resetBasketForTests } = require("@/src/lib/sales/basketStore");
  await __resetBasketForTests();
});

// Sell asks the server whether today is closed (migration 037); tests never
// reach a server, and an unreachable one means "not closed".
jest.mock("@/src/lib/day/queries", () => ({ fetchTodayClosed: async () => false }));

// The receipt sheet asks whether the shop's print station is there; tests never
// reach a server, and an unreachable one means "not available".
jest.mock("@/src/lib/print/queries", () => ({
  isStationOnline: async () => false,
  sendPrintJob: jest.fn(),
  fetchPrintJob: jest.fn(),
  requeuePrintJob: jest.fn(),
  claimNextPrintJob: jest.fn(),
  claimPrintJob: jest.fn(),
  finishPrintJob: jest.fn(),
  cancelPrintJob: jest.fn(),
  fetchStationJobs: jest.fn(),
}));
