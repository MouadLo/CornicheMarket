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
