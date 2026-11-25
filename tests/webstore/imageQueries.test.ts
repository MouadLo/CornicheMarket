import {
  copyAppPhotoToWeb,
  removeWebImageFile,
  setImageSource,
  uploadWebImage,
} from "../../src/lib/webstore/imageQueries";

// Everything the fake client is asked, in order.
const mockLog: string[] = [];
let mockRow: { image_path: string | null; image_source: string } | null = null;
let mockUploadError: { message: string } | null = null;
let mockCopyError: { message: string } | null = null;
let mockUpdateError: { message: string } | null = null;
let mockUpdates: unknown[] = [];
let mockRemoveFails = false;

jest.mock("base64-arraybuffer", () => ({ decode: () => new ArrayBuffer(1) }));
jest.mock("../../src/lib/supabase/client", () => ({
  supabase: {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            mockLog.push(`select ${table}`);
            return { data: mockRow, error: null };
          },
        }),
      }),
      update: (values: unknown) => ({
        eq: async (_col: string, id: string) => {
          mockLog.push(`update ${table} ${id}`);
          mockUpdates.push(values);
          return { error: mockUpdateError };
        },
      }),
    }),
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string, _body: unknown, options: unknown) => {
          mockLog.push(`upload ${bucket}/${path}`);
          expect(options).toEqual({ contentType: "image/jpeg", upsert: false });
          return { error: mockUploadError };
        },
        copy: async (from: string, to: string, options: unknown) => {
          mockLog.push(
            `copy ${bucket}/${from} -> ${(options as { destinationBucket: string }).destinationBucket}/${to}`
          );
          return { error: mockCopyError };
        },
        remove: async (paths: string[]) => {
          mockLog.push(`remove ${bucket}/${paths.join(",")}`);
          if (mockRemoveFails) throw new Error("offline");
          return { error: null };
        },
      }),
    },
  },
}));

beforeEach(() => {
  mockLog.length = 0;
  mockUpdates = [];
  mockRow = { image_path: null, image_source: "url" };
  mockUploadError = mockCopyError = mockUpdateError = null;
  mockRemoveFails = false;
});

describe("uploadWebImage", () => {
  it("uploads the jpeg, then points the mockRow at it, with nothing to delete the first time", async () => {
    const path = await uploadWebImage("p001", { base64: "AA==" }, 1700000000000);
    expect(path).toBe("p001/1700000000000.jpg");
    expect(mockLog).toEqual([
      "select web_products",
      "upload webstore-images/p001/1700000000000.jpg",
      "update web_products p001",
    ]);
    expect(mockUpdates).toEqual([{ image_path: "p001/1700000000000.jpg", image_source: "file" }]);
  });

  it("deletes the previous uploaded file only after the new one is stored and saved", async () => {
    mockRow = { image_path: "p001/1.jpg", image_source: "file" };
    await uploadWebImage("p001", { base64: "AA==" }, 2);
    expect(mockLog).toEqual([
      "select web_products",
      "upload webstore-images/p001/2.jpg",
      "update web_products p001",
      "remove webstore-images/p001/1.jpg",
    ]);
  });

  it("keeps the old file when the upload fails", async () => {
    mockRow = { image_path: "p001/1.jpg", image_source: "file" };
    mockUploadError = { message: "too big" };
    await expect(uploadWebImage("p001", { base64: "AA==" }, 2)).rejects.toThrow("too big");
    expect(mockLog.some((l) => l.startsWith("remove"))).toBe(false);
    expect(mockUpdates).toEqual([]);
  });

  it("removes the new file again, and keeps the old one, when the mockRow cannot be updated", async () => {
    mockRow = { image_path: "p001/1.jpg", image_source: "file" };
    mockUpdateError = { message: "denied" };
    await expect(uploadWebImage("p001", { base64: "AA==" }, 2)).rejects.toThrow("denied");
    expect(mockLog).toContain("remove webstore-images/p001/2.jpg");
    expect(mockLog).not.toContain("remove webstore-images/p001/1.jpg");
  });

  it("does not fail when the old file cannot be deleted", async () => {
    mockRow = { image_path: "p001/1.jpg", image_source: "url" };
    mockRemoveFails = true;
    await expect(uploadWebImage("p001", { base64: "AA==" }, 2)).resolves.toBe("p001/2.jpg");
  });
});

describe("copyAppPhotoToWeb", () => {
  it("copies from the private bucket to the public one and never removes the app photo", async () => {
    mockRow = { image_path: "p001/1.jpg", image_source: "url" };
    const path = await copyAppPhotoToWeb("p001", "uuid-1/abc.jpg", 5);
    expect(path).toBe("p001/5.jpg");
    expect(mockLog).toEqual([
      "select web_products",
      "copy product-photos/uuid-1/abc.jpg -> webstore-images/p001/5.jpg",
      "update web_products p001",
      "remove webstore-images/p001/1.jpg",
    ]);
    expect(mockLog.some((l) => l.startsWith("remove product-photos"))).toBe(false);
    expect(mockUpdates).toEqual([{ image_path: "p001/5.jpg", image_source: "file" }]);
  });

  it("changes nothing when the copy fails", async () => {
    mockRow = { image_path: "p001/1.jpg", image_source: "file" };
    mockCopyError = { message: "not found" };
    await expect(copyAppPhotoToWeb("p001", "uuid-1/abc.jpg", 5)).rejects.toThrow("not found");
    expect(mockUpdates).toEqual([]);
    expect(mockLog.some((l) => l.startsWith("remove"))).toBe(false);
  });
});

describe("setImageSource", () => {
  it("switches to the link and deletes nothing", async () => {
    mockRow = { image_path: "p001/1.jpg", image_source: "file" };
    await setImageSource("p001", "url");
    expect(mockUpdates).toEqual([{ image_source: "url" }]);
    expect(mockLog.some((l) => l.startsWith("remove"))).toBe(false);
  });

  it("switches to the file when one exists", async () => {
    mockRow = { image_path: "p001/1.jpg", image_source: "url" };
    await setImageSource("p001", "file");
    expect(mockUpdates).toEqual([{ image_source: "file" }]);
  });

  it("refuses the file when none was uploaded", async () => {
    await expect(setImageSource("p001", "file")).rejects.toThrow();
    expect(mockUpdates).toEqual([]);
  });

  it("passes a database error on", async () => {
    mockUpdateError = { message: "denied" };
    await expect(setImageSource("p001", "url")).rejects.toThrow("denied");
  });
});

describe("removeWebImageFile", () => {
  it("clears the mockRow first, goes back to the link, then deletes only the uploaded file", async () => {
    mockRow = { image_path: "p001/1.jpg", image_source: "file" };
    await removeWebImageFile("p001");
    expect(mockUpdates).toEqual([{ image_path: null, image_source: "url" }]);
    expect(mockLog).toEqual([
      "select web_products",
      "update web_products p001",
      "remove webstore-images/p001/1.jpg",
    ]);
  });

  it("does nothing when there is no uploaded file", async () => {
    await removeWebImageFile("p001");
    expect(mockLog).toEqual(["select web_products"]);
  });

  it("keeps the file when the mockRow cannot be updated", async () => {
    mockRow = { image_path: "p001/1.jpg", image_source: "file" };
    mockUpdateError = { message: "denied" };
    await expect(removeWebImageFile("p001")).rejects.toThrow("denied");
    expect(mockLog.some((l) => l.startsWith("remove"))).toBe(false);
  });
});
