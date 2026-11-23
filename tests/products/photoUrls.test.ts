import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  __resetPhotoUrlsForTests,
  forgetPhotoUrl,
  getPhotoUrl,
  requestPhotoUrls,
} from "../../src/lib/products/photoUrls";

const mockSign = jest.fn();
jest.mock("../../src/lib/supabase/client", () => ({
  supabase: {
    storage: { from: () => ({ createSignedUrls: (...a: unknown[]) => mockSign(...a) }) },
  },
}));

const ok = (paths: string[]) => ({
  data: paths.map((path) => ({ path, signedUrl: `https://x/${path}?t=1`, error: null })),
  error: null,
});
const settle = async () => {
  await new Promise((r) => setTimeout(r, 5));
  await requestPhotoUrls([]);
};

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  __resetPhotoUrlsForTests();
});

it("signs everything asked in the same moment in one batch, for 7 days", async () => {
  mockSign.mockImplementation(async (paths: string[]) => ok(paths));
  void requestPhotoUrls(["p1/a.jpg", "p2/b.jpg"]);
  void requestPhotoUrls(["p2/b.jpg", "p3/c.jpg", null]);
  await settle();
  expect(mockSign).toHaveBeenCalledTimes(1);
  expect(mockSign).toHaveBeenCalledWith(["p1/a.jpg", "p2/b.jpg", "p3/c.jpg"], 7 * 24 * 3600);
  expect(getPhotoUrl("p2/b.jpg")).toBe("https://x/p2/b.jpg?t=1");
});

it("does not ask again for a URL that is still good, and persists it", async () => {
  mockSign.mockImplementation(async (paths: string[]) => ok(paths));
  void requestPhotoUrls(["p1/a.jpg"]);
  await settle();
  void requestPhotoUrls(["p1/a.jpg"]);
  await settle();
  expect(mockSign).toHaveBeenCalledTimes(1);
  expect(await AsyncStorage.getItem("corniche.productPhotoUrls.v1")).toContain("p1/a.jpg");
});

it("a fresh start reads the URLs persisted on the device (works offline)", async () => {
  mockSign.mockImplementation(async (paths: string[]) => ok(paths));
  void requestPhotoUrls(["p1/a.jpg"]);
  await settle();
  __resetPhotoUrlsForTests();
  mockSign.mockRejectedValue(new Error("offline"));
  void requestPhotoUrls(["p1/a.jpg"]);
  await settle();
  expect(getPhotoUrl("p1/a.jpg")).toBe("https://x/p1/a.jpg?t=1");
  // Still good: no request needed at all.
  expect(mockSign).toHaveBeenCalledTimes(1);
});

it("a failed or offline signing keeps what is cached and gives no URL for the rest", async () => {
  mockSign.mockRejectedValue(new Error("offline"));
  void requestPhotoUrls(["p9/z.jpg"]);
  await settle();
  expect(getPhotoUrl("p9/z.jpg")).toBeNull();
  mockSign.mockResolvedValue({ data: null, error: { message: "boom" } });
  void requestPhotoUrls(["p9/z.jpg"]);
  await settle();
  expect(getPhotoUrl("p9/z.jpg")).toBeNull();
});

it("skips entries the server could not sign", async () => {
  mockSign.mockResolvedValue({
    data: [
      { path: "p1/a.jpg", signedUrl: "https://x/a", error: null },
      { path: "p2/b.jpg", signedUrl: null, error: "Object not found" },
    ],
    error: null,
  });
  void requestPhotoUrls(["p1/a.jpg", "p2/b.jpg"]);
  await settle();
  expect(getPhotoUrl("p1/a.jpg")).toBe("https://x/a");
  expect(getPhotoUrl("p2/b.jpg")).toBeNull();
});

it("forgetting a replaced photo drops its URL", async () => {
  mockSign.mockImplementation(async (paths: string[]) => ok(paths));
  void requestPhotoUrls(["p1/a.jpg"]);
  await settle();
  forgetPhotoUrl("p1/a.jpg");
  expect(getPhotoUrl("p1/a.jpg")).toBeNull();
});
