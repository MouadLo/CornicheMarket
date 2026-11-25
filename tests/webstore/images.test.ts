import {
  canUseSource,
  effectiveImage,
  fileImage,
  isValidWebImagePath,
  linkImage,
  newWebImagePath,
  webImageUrl,
} from "../../src/lib/webstore/images";

const BASE = "https://proj.supabase.co";

describe("effectiveImage", () => {
  it("shows the link when the source is url", () => {
    expect(
      effectiveImage(
        { image_url: "https://img/a.jpg", image_path: "p001/1.jpg", image_source: "url" },
        BASE
      )
    ).toBe("https://img/a.jpg");
  });

  it("shows the stored file when the source is file", () => {
    expect(
      effectiveImage(
        { image_url: "https://img/a.jpg", image_path: "p001/1.jpg", image_source: "file" },
        BASE
      )
    ).toBe(`${BASE}/storage/v1/object/public/webstore-images/p001/1.jpg`);
  });

  it("shows nothing for the url source without a link, and ignores a blank link", () => {
    expect(effectiveImage({ image_url: null, image_path: null, image_source: "url" }, BASE)).toBe(
      null
    );
    expect(
      effectiveImage({ image_url: "  ", image_path: "p/1.jpg", image_source: "url" }, BASE)
    ).toBe(null);
  });

  it("falls back to the link when the file source has lost its file", () => {
    expect(
      effectiveImage(
        { image_url: "https://img/a.jpg", image_path: null, image_source: "file" },
        BASE
      )
    ).toBe("https://img/a.jpg");
  });
});

it("builds public addresses without a double slash", () => {
  expect(webImageUrl("p001/1.jpg", `${BASE}/`)).toBe(
    `${BASE}/storage/v1/object/public/webstore-images/p001/1.jpg`
  );
  expect(fileImage({ image_path: null }, BASE)).toBe(null);
  expect(linkImage({ image_url: " https://x/y.png " })).toBe("https://x/y.png");
});

it("names uploads <id>/<timestamp>.jpg", () => {
  expect(newWebImagePath("p001", 1700000000000)).toBe("p001/1700000000000.jpg");
  expect(isValidWebImagePath(newWebImagePath("p001", 1700000000000))).toBe(true);
});

it("validates paths like the database check", () => {
  expect(isValidWebImagePath("p001/a.b-c_d.jpg")).toBe(true);
  expect(isValidWebImagePath("x.jpg")).toBe(false);
  expect(isValidWebImagePath("p001/../x.jpg")).toBe(false);
  expect(isValidWebImagePath("p001/a/b.jpg")).toBe(false);
  expect(isValidWebImagePath("p 1/a.jpg")).toBe(false);
  expect(isValidWebImagePath("a".repeat(21) + "/a.jpg")).toBe(false);
  expect(isValidWebImagePath(null)).toBe(false);
});

it("the uploaded file can be chosen only when it exists", () => {
  expect(canUseSource({ image_path: null }, "file")).toBe(false);
  expect(canUseSource({ image_path: "p001/1.jpg" }, "file")).toBe(true);
  expect(canUseSource({ image_path: null }, "url")).toBe(true);
});
