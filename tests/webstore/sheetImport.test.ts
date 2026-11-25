import {
  buildImportSql,
  priceToCents,
  sqlLiteral,
  validateSheetFeed,
  type SheetFeed,
} from "../../src/lib/webstore/sheetImport";

const base = (): SheetFeed => ({
  categories: [
    {
      id: "drinks",
      name: "Cold drinks",
      name_fr: "Boissons",
      icon: "drinks",
      subs: [
        { id: "Water", name: "Water", name_fr: "Eau" },
        { id: "Soft drinks", name: "Soft drinks", name_fr: "Sodas" },
      ],
    },
    { id: "snacks", name: "Snacks", name_fr: "Snacks", subs: [] },
  ],
  products: [
    {
      id: "p001",
      name: "Pom's",
      name_fr: "Jus d'orange",
      size: "1 L",
      cat: "drinks",
      sub: "Water",
      price: 7.5,
      stock: true,
      popular: true,
      image: "https://example.com/p001.jpg",
      keywords: "jus",
    },
    { id: "p002", name: "Chips", cat: "snacks", sub: null, price: null, stock: false },
    { id: "p003", name: "Cola", cat: "drinks", sub: "Soft drinks", price: 12 },
  ],
  kits: [
    {
      id: "kit_a",
      name: "Kit A",
      name_fr: "Kit A fr",
      items: [
        { id: "p001", qty: 2 },
        { id: "p999", qty: 1 },
      ],
    },
  ],
});

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

describe("validateSheetFeed", () => {
  it("accepts a good feed without errors", () => {
    const r = validateSheetFeed(base());
    expect(r.errors).toEqual([]);
    expect(r.feed).not.toBeNull();
  });

  it("rejects non-objects and missing lists", () => {
    expect(validateSheetFeed(null).feed).toBeNull();
    expect(validateSheetFeed([]).errors).toHaveLength(1);
    const r = validateSheetFeed({ categories: [], products: [] });
    expect(r.errors.join()).toContain('"kits"');
  });

  it("errors on bad ids", () => {
    const f = clone(base());
    f.products[0].id = "bad id!";
    f.categories[0].id = "Drinks";
    f.kits[0].id = "x".repeat(41);
    const r = validateSheetFeed(f);
    expect(r.feed).toBeNull();
    expect(r.errors.filter((e) => e.includes("id must match"))).toHaveLength(3);
  });

  it("errors on names over the limits (kit name 60, others 120)", () => {
    const f = clone(base());
    f.products[0].name = "x".repeat(121);
    f.kits[0].name = "y".repeat(61);
    const r = validateSheetFeed(f);
    expect(r.errors.some((e) => e.includes("product p001") && e.includes("121"))).toBe(true);
    expect(r.errors.some((e) => e.includes("kit kit_a") && e.includes("61"))).toBe(true);
    const ok = clone(base());
    ok.products[0].name = "x".repeat(120);
    ok.kits[0].name = "y".repeat(60);
    expect(validateSheetFeed(ok).errors).toEqual([]);
  });

  it("errors on kit qty outside 1-10", () => {
    for (const qty of [0, 11, 1.5, -1]) {
      const f = clone(base());
      f.kits[0].items[0].qty = qty;
      expect(validateSheetFeed(f).errors.join()).toContain("qty");
    }
  });

  it("errors when the image is not https", () => {
    const f = clone(base());
    f.products[0].image = "http://example.com/a.jpg";
    expect(validateSheetFeed(f).errors.join()).toContain("https");
  });

  it("errors when the category is missing, warns on an unknown sub", () => {
    const f = clone(base());
    f.products[0].cat = "ghost";
    expect(validateSheetFeed(f).errors.join()).toContain("ghost");
    const g = clone(base());
    g.products[0].sub = "Nope";
    const r = validateSheetFeed(g);
    expect(r.errors).toEqual([]);
    expect(r.warnings.join()).toContain('sub "Nope"');
  });

  it("warns (not errors) on unknown kit items, null prices and duplicate ids", () => {
    const f = clone(base());
    f.products.push({ ...f.products[0] });
    const r = validateSheetFeed(f);
    expect(r.errors).toEqual([]);
    expect(r.warnings.join("\n")).toContain("p999 is not in the products list");
    expect(r.warnings.join("\n")).toContain("product p002: no price");
    expect(r.warnings.join("\n")).toContain("product p001: duplicate id");
  });

  it("errors on a negative or non-numeric price", () => {
    const f = clone(base());
    f.products[0].price = -3;
    f.products[2].price = "abc";
    expect(validateSheetFeed(f).errors).toHaveLength(2);
  });
});

describe("sqlLiteral", () => {
  it("doubles quotes and writes NULL", () => {
    expect(sqlLiteral("Pom's")).toBe("'Pom''s'");
    expect(sqlLiteral(null)).toBe("NULL");
    expect(sqlLiteral(undefined)).toBe("NULL");
    expect(sqlLiteral(true)).toBe("true");
    expect(sqlLiteral(30)).toBe("30");
  });
  it("keeps backslashes and $$ as plain characters", () => {
    expect(sqlLiteral("a\\b $$ c")).toBe("'a\\b $$ c'");
    expect(sqlLiteral("'; drop table x; --")).toBe("'''; drop table x; --'");
    expect(sqlLiteral("''")).toBe("''''''");
  });
  it("refuses NUL", () => {
    expect(() => sqlLiteral("a\u0000b")).toThrow();
  });
});

describe("priceToCents", () => {
  it("converts through the money helper", () => {
    expect(priceToCents(7.5)).toBe(750);
    expect(priceToCents(12)).toBe(1200);
    expect(priceToCents(0.1 + 0.2)).toBe(30);
    expect(priceToCents(1.15)).toBe(115);
    expect(priceToCents(null)).toBeNull();
    expect(priceToCents(undefined)).toBeNull();
  });
});

describe("buildImportSql", () => {
  const sql = buildImportSql(base());

  it("is one transaction in the right order", () => {
    expect(sql).toMatch(/^-- .*\n.*\nbegin;\n/);
    expect(sql.trimEnd().endsWith("commit;")).toBe(true);
    const order = [
      "insert into public.web_categories",
      "insert into public.web_subcategories",
      "insert into public.web_products",
      "insert into public.web_kits ",
      "delete from public.web_kit_items",
      "insert into public.web_kit_items",
    ].map((s) => sql.indexOf(s));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(sql.match(/\bbegin;/g)).toHaveLength(1);
    expect(sql.match(/\bcommit;/g)).toHaveLength(1);
  });

  it("escapes quotes", () => {
    expect(sql).toContain("'Pom''s'");
    expect(sql).toContain("'Jus d''orange'");
  });

  it("survives a nasty name", () => {
    const f = clone(base());
    f.products[0].name = "a'b\\c $$ d''; drop table web_products; --";
    const out = buildImportSql(f);
    expect(out).toContain("'a''b\\c $$ d''''; drop table web_products; --'");
  });

  it("writes prices in centimes and null as NULL", () => {
    expect(sql).toContain("750");
    expect(sql).not.toContain("7.5");
    expect(sql).toMatch(
      /'p002', 'Chips', NULL, NULL, 'snacks', NULL, false, NULL, NULL, NULL, false, true, 10\)/
    );
  });

  it("imports every product published and manual, never linked", () => {
    expect(sql).toMatch(/'p001'.*, true, 0\)/);
    expect(sql).toMatch(/'p003'.*, true, true, 20\)/);
    const products = sql.slice(
      sql.indexOf("insert into public.web_products"),
      sql.indexOf("insert into public.web_kits")
    );
    expect(products).not.toContain("product_id");
    expect(products.split("(")[1]).not.toContain("stock_mode");
  });

  it("never overwrites product_id, stock_mode or published on conflict", () => {
    const clauses = sql.match(/do update set [^;]*;/g) ?? [];
    expect(clauses.length).toBeGreaterThan(0);
    for (const c of clauses) {
      expect(c).not.toContain("product_id");
      expect(c).not.toContain("stock_mode");
      expect(c).not.toContain("published");
    }
  });

  it("imports a bad sub as null", () => {
    const f = clone(base());
    f.products[0].sub = "Nope";
    expect(buildImportSql(f)).toMatch(/'p001', 'Pom''s', 'Jus d''orange', '1 L', 'drinks', NULL,/);
  });

  it("replaces the items of imported kits and keeps unknown product ids", () => {
    expect(sql).toContain("delete from public.web_kit_items where kit_id in ('kit_a');");
    expect(sql).toContain("('kit_a', 'p001', 2, 0)");
    expect(sql).toContain("('kit_a', 'p999', 1, 10)");
  });

  it("sorts by position in the sheet", () => {
    expect(sql).toContain("('drinks', 'Cold drinks', 'Boissons', 'drinks', 0)");
    expect(sql).toContain("('snacks', 'Snacks', 'Snacks', 'bag', 10)");
    expect(sql).toContain("('drinks', 'Soft drinks', 'Soft drinks', 'Sodas', 10)");
  });

  it("collapses duplicate ids so one statement never hits a row twice", () => {
    const f = clone(base());
    f.products.push({ ...f.products[0], name: "Second" });
    const out = buildImportSql(f);
    expect(out.match(/\('p001'/g)).toHaveLength(1);
    expect(out).toContain("'Second'");
  });
});
