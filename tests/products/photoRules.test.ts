import {
  buildPhotoPath,
  chunk,
  isValidPhotoPath,
  mergeSigned,
  needsRefresh,
  parseUrlCache,
  pathsToSign,
  pruneCache,
  REFRESH_BEFORE_MS,
  resizeActions,
  URL_TTL_SECONDS,
} from "../../src/lib/products/photoRules";
import {
  decideStorable,
  isUuid,
  PRODUCT_PHOTO_MAX_BYTES,
  productPhotoPath,
} from "../../supabase/functions/_shared/productPhoto";

const PID = "53000000-0000-0000-0000-000000000001";
const UID = "11111111-1111-1111-1111-111111111111";

describe("photo paths", () => {
  it("builds <product>/<uuid>.jpg", () => {
    expect(buildPhotoPath(PID, UID.toUpperCase())).toBe(`${PID}/${UID}.jpg`);
  });

  it("accepts only this product's folder and a uuid file name", () => {
    expect(isValidPhotoPath(PID, `${PID}/${UID}.jpg`)).toBe(true);
    expect(isValidPhotoPath(PID, `${PID}/${UID}.webp`)).toBe(true);
    expect(isValidPhotoPath(PID, `${PID}/${UID}.gif`)).toBe(false);
    expect(isValidPhotoPath(PID, `other/${UID}.jpg`)).toBe(false);
    expect(isValidPhotoPath(PID, `${PID}/../x.jpg`)).toBe(false);
    expect(isValidPhotoPath(PID, `${PID}/a/${UID}.jpg`)).toBe(false);
    expect(isValidPhotoPath(PID, `${PID}/name.jpg`)).toBe(false);
    expect(isValidPhotoPath(PID, null)).toBe(false);
  });

  it("the edge function and the app build the same shape", () => {
    expect(productPhotoPath(PID, UID, "jpg")).toBe(buildPhotoPath(PID, UID));
    expect(isValidPhotoPath(PID, productPhotoPath(PID, UID, "png"))).toBe(true);
  });
});

describe("resizeActions", () => {
  it("shrinks the long side to 800 px", () => {
    expect(resizeActions(3000, 2000)).toEqual([{ resize: { width: 800 } }]);
    expect(resizeActions(2000, 3000)).toEqual([{ resize: { height: 800 } }]);
  });
  it("never enlarges a small picture", () => {
    expect(resizeActions(800, 600)).toEqual([]);
    expect(resizeActions(300, 200)).toEqual([]);
  });
  it("with an unknown size still caps the width", () => {
    expect(resizeActions(0, 0)).toEqual([{ resize: { width: 800 } }]);
  });
});

describe("signed URL cache", () => {
  const now = 1_000_000;
  const fresh = { url: "u", expiresAt: now + 3 * REFRESH_BEFORE_MS };
  const old = { url: "u", expiresAt: now + REFRESH_BEFORE_MS - 1 };

  it("a URL is renewed when missing or with less than a day left", () => {
    expect(needsRefresh(undefined, now)).toBe(true);
    expect(needsRefresh(old, now)).toBe(true);
    expect(needsRefresh(fresh, now)).toBe(false);
  });

  it("asks to sign only distinct paths without a good URL", () => {
    const cache = { a: fresh, b: old };
    expect(pathsToSign(["a", "b", "c", "c", null, undefined, ""], cache, now)).toEqual(["b", "c"]);
  });

  it("merging stamps the expiry and leaves other paths alone", () => {
    const merged = mergeSigned(
      { a: fresh },
      [
        { path: "b", url: "ub" },
        { path: "", url: "x" },
      ],
      now
    );
    expect(merged.a).toBe(fresh);
    expect(merged.b).toEqual({ url: "ub", expiresAt: now + URL_TTL_SECONDS * 1000 });
    expect(Object.keys(merged)).toEqual(["a", "b"]);
  });

  it("keeps the newest entries when it grows too large", () => {
    const cache = {
      a: { url: "a", expiresAt: 1 },
      b: { url: "b", expiresAt: 3 },
      c: { url: "c", expiresAt: 2 },
    };
    expect(Object.keys(pruneCache(cache, 2)).sort()).toEqual(["b", "c"]);
    expect(pruneCache(cache, 5)).toBe(cache);
  });

  it("reads the persisted copy and drops what is malformed", () => {
    expect(parseUrlCache(null)).toEqual({});
    expect(parseUrlCache("not json")).toEqual({});
    expect(
      parseUrlCache(JSON.stringify({ a: { url: "u", expiresAt: 5 }, b: { url: 3 }, c: null }))
    ).toEqual({ a: { url: "u", expiresAt: 5 } });
  });

  it("chunks", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});

describe("competitor photo stored as it is", () => {
  it("accepts jpeg, png and webp up to 2 MB", () => {
    expect(decideStorable("image/jpeg", 1000)).toEqual({
      ok: true,
      extension: "jpg",
      contentType: "image/jpeg",
    });
    expect(decideStorable("image/png", PRODUCT_PHOTO_MAX_BYTES)).toMatchObject({
      ok: true,
      extension: "png",
    });
    expect(decideStorable("IMAGE/WEBP", 5)).toMatchObject({ ok: true, extension: "webp" });
  });
  it("refuses with a reason so the app can fall back", () => {
    expect(decideStorable("image/avif", 5)).toEqual({ ok: false, reason: "unsupported_type" });
    expect(decideStorable("image/gif", 5)).toEqual({ ok: false, reason: "unsupported_type" });
    expect(decideStorable("image/jpeg", PRODUCT_PHOTO_MAX_BYTES + 1)).toEqual({
      ok: false,
      reason: "too_large",
    });
  });
  it("only a uuid is a product id", () => {
    expect(isUuid(PID)).toBe(true);
    expect(isUuid("../x")).toBe(false);
    expect(isUuid(undefined)).toBe(false);
  });
});
