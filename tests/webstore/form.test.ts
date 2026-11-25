import { isValidImageUrl, validateForm, type FormValues } from "../../src/lib/webstore/form";
import type { WebCategory } from "../../src/lib/webstore/types";

const categories: WebCategory[] = [
  {
    id: "drinks",
    name: "Drinks",
    name_fr: "Boissons",
    icon: "bag",
    sort: 0,
    subs: [{ code: "soda", name: "Soda", name_fr: "Sodas", sort: 0 }],
  },
  { id: "snacks", name: "Snacks", name_fr: "Snacks", icon: "bag", sort: 1, subs: [] },
];

const values = (over: Partial<FormValues> = {}): FormValues => ({
  name: "Coca",
  nameFr: "",
  size: "",
  categoryId: "drinks",
  subCode: null,
  popular: false,
  keywords: "",
  imageUrl: "",
  priceText: "",
  stockMode: "manual",
  manualInStock: true,
  ...over,
});

const run = (over: Partial<FormValues>, linked = false) =>
  validateForm(values(over), { linked, categories });

describe("validateForm", () => {
  it("accepts the minimum and turns empty strings into null", () => {
    const { errors, patch } = run({});
    expect(errors).toEqual({});
    expect(patch).toMatchObject({
      name: "Coca",
      name_fr: null,
      size: null,
      keywords: null,
      image_url: null,
      price_cents: null,
      sub_code: null,
    });
  });
  it("requires an English name, trimmed", () => {
    expect(run({ name: "   " }).errors.name).toBe("webstore.errNameRequired");
  });
  it("limits both names to 120 characters", () => {
    expect(run({ name: "a".repeat(121) }).errors.name).toBe("webstore.errNameTooLong");
    expect(run({ nameFr: "a".repeat(121) }).errors.nameFr).toBe("webstore.errNameTooLong");
    expect(run({ name: "a".repeat(120), nameFr: "b".repeat(120) }).errors).toEqual({});
  });
  it("requires a known category", () => {
    expect(run({ categoryId: "" }).errors.category).toBe("webstore.errCategoryRequired");
    expect(run({ categoryId: "ghost" }).errors.category).toBe("webstore.errCategoryRequired");
  });
  it("keeps a sub-category of the chosen category and drops a foreign one", () => {
    expect(run({ subCode: "soda" }).patch?.sub_code).toBe("soda");
    expect(run({ categoryId: "snacks", subCode: "soda" }).patch?.sub_code).toBeNull();
  });
  it("parses the typed price to centimes, comma or dot", () => {
    expect(run({ priceText: "12.50" }).patch?.price_cents).toBe(1250);
    expect(run({ priceText: "6,5" }).patch?.price_cents).toBe(650);
    expect(run({ priceText: "0" }).patch?.price_cents).toBe(0);
  });
  it("rejects a price that is not a number, negative or absurd", () => {
    expect(run({ priceText: "abc" }).errors.price).toBe("webstore.errPrice");
    expect(run({ priceText: "-3" }).errors.price).toBe("webstore.errPrice");
    expect(run({ priceText: "99999999" }).errors.price).toBe("webstore.errPrice");
  });
  it("while linked the price is neither validated nor written", () => {
    const { errors, patch } = run({ priceText: "abc" }, true);
    expect(errors.price).toBeUndefined();
    expect(patch).not.toHaveProperty("price_cents");
  });
  it("automatic stock needs a link", () => {
    expect(run({ stockMode: "auto" }).errors.stock).toBe("webstore.errAutoNeedsLink");
    expect(run({ stockMode: "auto" }, true).errors).toEqual({});
  });
  it("collects every error at once and gives no patch", () => {
    const r = run({ name: "", categoryId: "", priceText: "x", imageUrl: "http://a.b/c.png" });
    expect(Object.keys(r.errors).sort()).toEqual(["category", "image", "name", "price"]);
    expect(r.patch).toBeNull();
  });
});

describe("isValidImageUrl", () => {
  it.each(["https://cdn.example.com/a.png", " https://x.ma/p?a=1 "])("accepts %j", (u) => {
    expect(isValidImageUrl(u)).toBe(true);
  });
  it.each(["http://x.ma/a.png", "ftp://x/a", "https://", "https://a b.com", "x.ma/a.png", ""])(
    "rejects %j",
    (u) => {
      expect(isValidImageUrl(u)).toBe(false);
    }
  );
});
