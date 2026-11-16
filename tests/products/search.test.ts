import { normalizeSearch, rankBySearch, searchRank } from "@/src/lib/products/search";

const names = (rows: { name: string }[]) => rows.map((row) => row.name);

describe("normalizeSearch", () => {
  it("drops accents and case", () => {
    expect(normalizeSearch("  Épicerie ")).toBe("epicerie");
    expect(normalizeSearch("Café")).toBe("cafe");
  });
});

describe("searchRank", () => {
  it.each([
    ["Coca-Cola 33cl", "coca-cola 33cl", 0],
    ["Coca-Cola 33cl", "co", 1],
    ["Pain au lait", "lait", 2], // a word that starts with it
    ["Barre chocolatee", "co", 3], // only contains it
    ["Coca-Cola 33cl", "xyz", null],
    ["Coca-Cola 33cl", "", null],
  ])("%s for %j is %s", (name, query, rank) => {
    expect(searchRank({ name }, query)).toBe(rank);
  });

  it("matches a barcode from its start, like the server", () => {
    expect(searchRank({ name: "Eau", barcode: "6111000000012" }, "611100")).toBe(1);
    expect(searchRank({ name: "Eau", barcode: "6111000000012" }, "100000")).toBeNull();
  });
});

describe("rankBySearch", () => {
  const products = [
    { name: "Barre chocolatee" },
    { name: "Chocolat Nestle Dessert" },
    { name: "Coca-Cola 1.5L" },
    { name: "Coca-Cola 33cl" },
    { name: "Concentre de tomate" },
    { name: "Pain au lait" },
    { name: "Lait Centrale 1L" },
  ];

  it("puts names that start with the query first, then words, then the rest", () => {
    expect(names(rankBySearch(products, "co"))).toEqual([
      "Coca-Cola 1.5L",
      "Coca-Cola 33cl",
      "Concentre de tomate",
      "Barre chocolatee",
      "Chocolat Nestle Dessert",
    ]);
  });

  it("ranks a word-start match above a plain contains", () => {
    expect(names(rankBySearch(products, "lait"))).toEqual(["Lait Centrale 1L", "Pain au lait"]);
  });

  it("returns nothing for no match and keeps accents out of the way", () => {
    expect(rankBySearch(products, "zzz")).toEqual([]);
    expect(names(rankBySearch([{ name: "Épicerie fine" }], "epic"))).toEqual(["Épicerie fine"]);
  });
});
