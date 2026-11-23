import { Platform } from "react-native";

import { downloadCompetitorImage } from "../../src/lib/competitors/imageDownload";
import { fetchCompetitorImage } from "../../src/lib/competitors/shops";

const mockWrite = jest.fn();
const mockShare = jest.fn();
jest.mock("expo-file-system", () => ({
  cacheDirectory: "file:///cache/",
  EncodingType: { Base64: "base64" },
  writeAsStringAsync: (...a: unknown[]) => mockWrite(...a),
}));
jest.mock("expo-sharing", () => ({
  isAvailableAsync: jest.fn().mockResolvedValue(true),
  shareAsync: (...a: unknown[]) => mockShare(...a),
}));
jest.mock("../../src/lib/competitors/shops", () => ({ fetchCompetitorImage: jest.fn() }));

const PNG_BASE64 = "iVBORw0KGgo="; // 8 bytes of a PNG signature
const setOs = (os: string) =>
  Object.defineProperty(Platform, "OS", { get: () => os, configurable: true });

afterEach(() => {
  jest.clearAllMocks();
  setOs("ios");
  // @ts-expect-error cleanup of the web stubs
  delete global.document;
});

it("web: asks the function for the stored url and triggers a browser download named after the product", async () => {
  setOs("web");
  jest.mocked(fetchCompetitorImage).mockResolvedValue({
    status: "ok",
    contentType: "image/png",
    extension: "png",
    base64: PNG_BASE64,
  });
  const click = jest.fn();
  const link: Record<string, unknown> = { click };
  // @ts-expect-error minimal DOM stub
  global.document = { createElement: jest.fn().mockReturnValue(link) };
  const created = jest.fn().mockReturnValue("blob:abc");
  const revoked = jest.fn();
  Object.assign(URL, { createObjectURL: created, revokeObjectURL: revoked });

  const result = await downloadCompetitorImage("https://night.ma/a.jpg", "Crème Brûlée 100 g");

  expect(result).toBe("saved");
  expect(fetchCompetitorImage).toHaveBeenCalledWith("https://night.ma/a.jpg");
  expect(link.download).toBe("creme-brulee-100-g.png");
  expect(link.href).toBe("blob:abc");
  expect(click).toHaveBeenCalledTimes(1);
  expect(revoked).toHaveBeenCalledWith("blob:abc");
  const blob = created.mock.calls[0][0] as Blob;
  expect(blob.type).toBe("image/png");
  expect(blob.size).toBe(8);
  expect(mockWrite).not.toHaveBeenCalled();
});

it("native: writes the bytes to the cache and opens the share sheet", async () => {
  jest.mocked(fetchCompetitorImage).mockResolvedValue({
    status: "ok",
    contentType: "image/webp",
    extension: "webp",
    base64: "AAAA",
  });
  expect(await downloadCompetitorImage("https://night.ma/a.webp", "Sidi Ali 50cl")).toBe("saved");
  expect(mockWrite).toHaveBeenCalledWith("file:///cache/sidi-ali-50cl.webp", "AAAA", {
    encoding: "base64",
  });
  expect(mockShare).toHaveBeenCalledWith("file:///cache/sidi-ali-50cl.webp", {
    mimeType: "image/webp",
    dialogTitle: "sidi-ali-50cl.webp",
  });
});

it("a refusal or an error saves nothing", async () => {
  jest
    .mocked(fetchCompetitorImage)
    .mockResolvedValueOnce({ status: "refused", detail: "http_403" });
  expect(await downloadCompetitorImage("https://x.ma/a.jpg", "A")).toBe("refused");
  jest
    .mocked(fetchCompetitorImage)
    .mockResolvedValueOnce({ status: "error", detail: "not_an_image" });
  expect(await downloadCompetitorImage("https://x.ma/a.jpg", "A")).toBe("error");
  expect(mockWrite).not.toHaveBeenCalled();
  expect(mockShare).not.toHaveBeenCalled();
});
