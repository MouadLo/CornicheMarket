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
