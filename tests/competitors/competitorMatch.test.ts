import {
  classify,
  compareSizes,
  extractSize,
  HIGH_SCORE,
  LOW_SCORE,
  matchCatalog,
  normalizeName,
  prepareName,
  scoreNames,
  tokenize,
} from "../../supabase/functions/_shared/competitorMatch";

const size = (text: string) => extractSize(normalizeName(text)).size;
const cls = (ours: string, theirs: string) => classify(scoreNames(ours, theirs));

describe("normalizeName", () => {
  it("lowercases, strips accents and decodes entities", () => {
    expect(normalizeName("Crème Fraîche &amp; Épices")).toBe("creme fraiche & epices");
    expect(normalizeName("Biscuits &#8211; Chocolat")).toBe("biscuits chocolat");
    expect(normalizeName("Coca&#8209;Cola")).toContain("coca");
    expect(normalizeName("  L&rsquo;Oréal   Paris ")).toBe("l'oreal paris");
  });
  it("splits cocacola", () => {
    expect(normalizeName("CocaCola 33cl")).toBe("coca cola 33cl");
  });
});

describe("extractSize", () => {
  it("unifies volumes: 1.5L = 1,5 l = 150cl = 1500ml", () => {
    for (const text of [
      "Sidi Ali 1.5L",
      "Sidi Ali 1,5 l",
      "sidi ali 150cl",
      "Sidi Ali 1500 ml",
      "Sidi Ali 1.5 litres",
    ]) {
      expect(size(text).millilitres).toBe(1500);
    }
    expect(size("Sidi Ali 50cl").millilitres).toBe(500);
    expect(size("Eau 0.5L").millilitres).toBe(500);
    expect(size("Coca 33cl").millilitres).toBe(330);
  });
  it("unifies masses: g, gr, grammes, kg", () => {
    for (const text of [
      "Chips 100g",
      "Chips 100 gr",
      "Chips 100 grammes",
      "chips 0.1kg",
      "chips 0,1 kg",
    ]) {
      expect(size(text).grams).toBe(100);
    }
    expect(size("Sucre 1kg").grams).toBe(1000);
    expect(size("Farine 1 kilo").grams).toBe(1000);
  });
  it("reads pack counts: x4, 4x, pack de 4, lot de 6", () => {
    expect(size("Yaourt x4").count).toBe(4);
    expect(size("Yaourt X 4").count).toBe(4);
    expect(size("Yaourt 4x").count).toBe(4);
    expect(size("Yaourt pack de 4").count).toBe(4);
    expect(size("Yaourt pack of 4").count).toBe(4);
    expect(size("Yaourt lot de 6").count).toBe(6);
    expect(size("Yaourt 4 pièces").count).toBe(4);
  });
  it("reads 6 x 33cl as a count and a unit size", () => {
    const s = size("Coca-Cola 6 x 33cl");
    expect(s).toEqual({ grams: null, millilitres: 330, count: 6 });
    expect(size("Coca-Cola 6x33cl").count).toBe(6);
    expect(size("Coca-Cola 33cl x6")).toEqual({ grams: null, millilitres: 330, count: 6 });
  });
  it("removes the size from the text", () => {
    expect(extractSize("sidi ali 1.5l").rest).toBe("sidi ali");
    expect(extractSize("yaourt pack de 4 nature").rest).toBe("yaourt nature");
  });
  it("does not read letters inside words as units", () => {
    expect(size("Lait gras 3 stars").grams).toBeNull();
    expect(size("Sauce 2 gout").grams).toBeNull();
    expect(size("Bonbon 5 lutins").millilitres).toBeNull();
  });
  it("a pack of one is no pack", () => {
    expect(size("Yaourt x1").count).toBeNull();
  });
});

describe("tokenize", () => {
  it("drops stop words but keeps sans", () => {
    expect(tokenize("moutarde de dijon sans gluten")).toEqual([
      "moutarde",
      "dijon",
      "sans",
      "gluten",
    ]);
    expect(tokenize("the lait de la ferme with avec")).toEqual(["lait", "ferme"]);
  });
  it("stems plurals and dedupes", () => {
    expect(tokenize("chips chips biscuits")).toEqual(["chip", "biscuit"]);
  });
});

describe("compareSizes", () => {
  const s = (text: string) => size(text);
  it("same, veto, missing, mixed, none", () => {
    expect(compareSizes(s("a 150cl"), s("b 1.5l"))).toBe("same");
    expect(compareSizes(s("a 150cl"), s("b 50cl"))).toBe("veto");
    expect(compareSizes(s("a 100g"), s("b 200g"))).toBe("veto");
    expect(compareSizes(s("a x4"), s("b x6"))).toBe("veto");
    expect(compareSizes(s("a 100g"), s("b"))).toBe("missing");
    expect(compareSizes(s("a 360g"), s("b 37cl"))).toBe("mixed");
    expect(compareSizes(s("a"), s("b"))).toBe("none");
    expect(compareSizes(s("a x4"), s("b pack de 4"))).toBe("same");
  });
  it("a pack count against none is not decisive", () => {
    expect(compareSizes(s("Coca 33cl"), s("Coca 33cl x6"))).toBe("same");
  });
});

describe("scoreNames: pairs that must be proposed", () => {
  it("Lorenz Crunchips Paprika vs Crunchips Paprika 100g", () => {
    const result = scoreNames("Crunchips Paprika 100g", "Lorenz Crunchips Paprika");
    expect(result.score).toBeGreaterThanOrEqual(LOW_SCORE);
    expect(cls("Crunchips Paprika 100g", "Lorenz Crunchips Paprika")).not.toBe("none");
  });
  it("same name and same size is a strong match", () => {
    expect(scoreNames("Sidi Ali 1.5L", "Sidi Ali 150cl").score).toBe(1);
    expect(cls("Sidi Ali 1.5L", "Sidi Ali 150cl")).toBe("proposed");
    expect(cls("Sidi Ali 1.5L", "Sidi Ali 1,5 litres")).toBe("proposed");
  });
  it("Moutarde Dijon sans gluten (360g) vs Moutarde Star Dijon 37cl: proposed but uncertain", () => {
    const result = scoreNames(
      "Moutarde Star Dijon 37cl",
      "Moutarde De Dijon sans Gluten Star 360g"
    );
    expect(result.size).toBe("mixed");
    expect(result.uncertain).toBe(true);
    expect(classify(result)).toBe("uncertain");
  });
  it("order of words and accents do not matter", () => {
    expect(cls("Café Moulu Nescafé 200g", "NESCAFE cafe moulu 200 g")).toBe("proposed");
  });
  it("entities in their name are decoded", () => {
    expect(cls("Biscuit Chocolat Lu 150g", "Lu &#8211; Biscuit Chocolat 150 g")).not.toBe("none");
  });
  it("same size from different spellings: 1kg vs 1000g", () => {
    expect(cls("Sucre Cosumar 1kg", "Sucre Cosumar 1000g")).toBe("proposed");
  });
  it("a typo of a long word still matches", () => {
    expect(cls("Mayonnaise Heinz 400g", "Heinz Mayonaise 400g")).not.toBe("none");
  });
  it("a pack count is compared as written", () => {
    expect(cls("Danone Nature x4", "Danone Nature pack de 4")).toBe("proposed");
  });
});

describe("scoreNames: pairs that must NOT match", () => {
  it("Sidi Ali 1.5L vs 150cl matches but vs 50cl never does", () => {
    expect(cls("Sidi Ali 1.5L", "Sidi Ali 50cl")).toBe("none");
    expect(scoreNames("Sidi Ali 150cl", "Sidi Ali 50cl").score).toBe(0);
    expect(scoreNames("Sidi Ali 50cl", "Sidi Ali 1.5L").score).toBe(0);
  });
  it("Coca-Cola 33cl vs Coca-Cola 1L", () => {
    expect(cls("Coca-Cola 33cl", "Coca-Cola 1L")).toBe("none");
    expect(cls("Coca-Cola 33cl", "Coca-Cola 1 L")).toBe("none");
  });
  it("a different weight is a different product", () => {
    expect(cls("Chips Lays 100g", "Chips Lays 250g")).toBe("none");
  });
  it("a different pack count is a different product", () => {
    expect(cls("Yaourt Danone x4", "Yaourt Danone x6")).toBe("none");
  });
  it("nothing in common", () => {
    expect(cls("Sidi Ali 1.5L", "Chocolat Milka 100g")).toBe("none");
    expect(scoreNames("Lait", "Savon").score).toBe(0);
  });
  it("a size alone is not a match", () => {
    expect(scoreNames("Eau minerale 1.5L", "Jus orange 1.5L").score).toBeLessThan(LOW_SCORE);
    expect(scoreNames("Chips 100g", "Biscuit 100g").score).toBeLessThan(LOW_SCORE);
  });
  it("a different flavour does not reach the high threshold", () => {
    const result = scoreNames("Crunchips Paprika 100g", "Crunchips Fromage 100g");
    expect(classify(result)).not.toBe("proposed");
  });
  it("a variant word on one side only makes the pair uncertain", () => {
    const result = scoreNames("Coca-Cola 33cl", "Coca-Cola Zero 33cl");
    expect(result.uncertain).toBe(true);
    expect(classify(result)).toBe("uncertain");
  });
  it("empty names", () => {
    expect(scoreNames("", "Sidi Ali").score).toBe(0);
    expect(scoreNames("33cl", "33cl").score).toBe(0);
  });
});

describe("scoring is symmetric and bounded", () => {
  const names = [
    "Sidi Ali 1.5L",
    "Sidi Ali 50cl",
    "Crunchips Paprika 100g",
    "Lorenz Crunchips Paprika",
    "Moutarde Star Dijon 37cl",
    "Coca-Cola 33cl",
    "Coca-Cola Zero 33cl",
    "Danone x4",
  ];
  it.each(names.flatMap((a) => names.map((b) => [a, b])))("%s | %s", (a, b) => {
    const ab = scoreNames(a, b).score;
    expect(ab).toBeGreaterThanOrEqual(0);
    expect(ab).toBeLessThanOrEqual(1);
    expect(ab).toBeCloseTo(scoreNames(b, a).score, 4);
  });
});

describe("thresholds", () => {
  it("are ordered", () => {
    expect(LOW_SCORE).toBeLessThan(HIGH_SCORE);
  });
  it("classify", () => {
    expect(classify({ score: 0.49, uncertain: false, size: "none" })).toBe("none");
    expect(classify({ score: 0.5, uncertain: false, size: "none" })).toBe("uncertain");
    expect(classify({ score: 0.79, uncertain: false, size: "none" })).toBe("uncertain");
    expect(classify({ score: 0.8, uncertain: false, size: "none" })).toBe("proposed");
    expect(classify({ score: 0.95, uncertain: true, size: "mixed" })).toBe("uncertain");
  });
});

describe("matchCatalog", () => {
  const products = [
    { id: "p-crunch", name: "Crunchips Paprika 100g" },
    { id: "p-sidi15", name: "Sidi Ali 150cl" },
    { id: "p-sidi50", name: "Sidi Ali 50cl" },
    { id: "p-coca33", name: "Coca-Cola 33cl" },
    { id: "p-moutarde", name: "Moutarde Star Dijon 37cl" },
  ];
  const items = [
    { id: "i-crunch", name: "Lorenz Crunchips Paprika" },
    { id: "i-sidi15", name: "Sidi Ali 1.5L" },
    { id: "i-sidi50", name: "Sidi Ali 50cl" },
    { id: "i-sidi1", name: "Sidi Ali 1L" },
    { id: "i-coca1", name: "Coca-Cola 1L" },
    { id: "i-moutarde", name: "Moutarde De Dijon sans Gluten Star 360g" },
    { id: "i-other", name: "Chocolat Milka Noisettes 100g" },
  ];
  const result = (id: string, excluded = new Set<string>()) =>
    matchCatalog(items, products, excluded).find((r) => r.itemId === id)!;

  it("matches each item to the right size", () => {
    expect(result("i-sidi15").productId).toBe("p-sidi15");
    expect(result("i-sidi50").productId).toBe("p-sidi50");
    expect(result("i-crunch").productId).toBe("p-crunch");
  });
  it("does not match different sizes", () => {
    expect(result("i-sidi1").productId).toBeNull();
    expect(result("i-coca1").productId).toBeNull();
    expect(result("i-other").productId).toBeNull();
  });
  it("proposes the mustard as uncertain", () => {
    const m = result("i-moutarde");
    expect(m.productId).toBe("p-moutarde");
    expect(m.uncertain).toBe(true);
  });
  it("one of our products is matched by at most one item (the best)", () => {
    const rows = matchCatalog(
      [
        { id: "a", name: "Sidi Ali 50cl" },
        { id: "b", name: "Sidi Ali Eau Minerale Naturelle 50cl" },
      ],
      [{ id: "p", name: "Sidi Ali 50cl" }]
    );
    expect(rows.find((r) => r.itemId === "a")!.productId).toBe("p");
    expect(rows.find((r) => r.itemId === "b")!.productId).toBeNull();
    expect(new Set(rows.map((r) => r.productId).filter(Boolean)).size).toBe(1);
  });
  it("an item falls back to its second best product when the first is taken", () => {
    const rows = matchCatalog(
      [
        { id: "a", name: "Lait Centrale 1L" },
        { id: "b", name: "Lait Centrale Danone 1L" },
      ],
      [
        { id: "p1", name: "Lait Centrale 1L" },
        { id: "p2", name: "Lait Centrale Danone 1L" },
      ]
    );
    expect(rows.find((r) => r.itemId === "a")!.productId).toBe("p1");
    expect(rows.find((r) => r.itemId === "b")!.productId).toBe("p2");
  });
  it("never proposes an excluded (already matched) product", () => {
    expect(result("i-sidi15", new Set(["p-sidi15"])).productId).toBeNull();
  });
  it("is deterministic and keeps the item order", () => {
    const a = matchCatalog(items, products);
    const b = matchCatalog([...items], [...products].reverse());
    expect(a.map((r) => r.itemId)).toEqual(items.map((i) => i.id));
    expect(b.map((r) => r.productId)).toEqual(a.map((r) => r.productId));
  });
  it("handles empty input", () => {
    expect(matchCatalog([], products)).toEqual([]);
    expect(matchCatalog(items, []).every((r) => r.productId === null)).toBe(true);
  });
  it("scores are in [LOW, 1] for matches and 0 otherwise", () => {
    for (const r of matchCatalog(items, products)) {
      if (r.productId) {
        expect(r.score).toBeGreaterThanOrEqual(LOW_SCORE);
        expect(r.score).toBeLessThanOrEqual(1);
      } else expect(r.score).toBe(0);
    }
  });
});

describe("prepareName", () => {
  it("keeps brand tokens and drops sizes", () => {
    expect(prepareName("Lorenz Crunchips Paprika 100g").tokens).toEqual([
      "lorenz",
      "crunchip",
      "paprika",
    ]);
  });
});
