import { guessMapping, parseCsv, toCsv, validateRows } from "../../src/lib/products/csv";
import type { Category, Product } from "../../src/lib/products/queries";

const categories: Category[] = [
  { id: "cat-drinks", name: "Boissons" },
  { id: "cat-snacks", name: "Snacks" },
];

const emptyContext = { categories, existingBarcodes: new Set<string>() };

describe("guessMapping", () => {
  it("matches English headers", () => {
    const mapping = guessMapping(["Name", "Barcode", "Selling price", "Category"]);
    expect(mapping.name).toBe("Name");
    expect(mapping.barcode).toBe("Barcode");
    expect(mapping.selling_price).toBe("Selling price");
    expect(mapping.category).toBe("Category");
  });

  it("matches French headers, accents included", () => {
    const mapping = guessMapping(["Nom", "Code barre", "Prix de vente", "Catégorie", "Quantité"]);
    expect(mapping.name).toBe("Nom");
    expect(mapping.barcode).toBe("Code barre");
    expect(mapping.selling_price).toBe("Prix de vente");
    expect(mapping.category).toBe("Catégorie");
    expect(mapping.quantity).toBe("Quantité");
  });

  it("does not assign one column to two fields", () => {
    const mapping = guessMapping(["Prix de vente", "Prix d'achat"]);
    expect(mapping.selling_price).not.toBe(mapping.cost);
  });

  it("leaves unmatched fields undefined", () => {
    const mapping = guessMapping(["Something else"]);
    expect(mapping.name).toBeUndefined();
  });
});

describe("parseCsv", () => {
  it("reads headers and rows", () => {
    const { headers, rows } = parseCsv("name,price\nCoca,7.00\nPain,1.50\n");
    expect(headers).toEqual(["name", "price"]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ name: "Coca", price: "7.00" });
  });

  it("skips blank lines", () => {
    const { rows } = parseCsv("name,price\nCoca,7.00\n\n\n");
    expect(rows).toHaveLength(1);
  });
});

describe("validateRows", () => {
  const mapping = {
    name: "name",
    barcode: "barcode",
    category: "category",
    selling_price: "price",
    cost: "cost",
    quantity: "qty",
  };

  it("accepts a valid row and converts money to centimes", () => {
    const { rows, errors } = validateRows(
      [
        {
          name: "Coca-Cola 33cl",
          barcode: "611100001",
          category: "Boissons",
          price: "7,00",
          cost: "",
          qty: "",
        },
      ],
      mapping,
      emptyContext
    );

    expect(errors).toHaveLength(0);
    expect(rows[0].product.name).toBe("Coca-Cola 33cl");
    expect(rows[0].product.selling_price_cents).toBe(700);
    expect(rows[0].product.category_id).toBe("cat-drinks");
    expect(rows[0].opening).toBeNull();
  });

  it("reports the row number from the user's file", () => {
    const { errors } = validateRows(
      [{ name: "", price: "7.00" }],
      { name: "name", selling_price: "price" },
      emptyContext
    );
    // Header is row 1, so the first data row is row 2.
    expect(errors[0].rowNumber).toBe(2);
  });

  it("requires a name and a selling price", () => {
    const { rows, errors } = validateRows(
      [{ name: "", barcode: "", category: "", price: "", cost: "", qty: "" }],
      mapping,
      emptyContext
    );

    expect(rows).toHaveLength(0);
    expect(errors[0].messages).toContain("Name is required");
    expect(errors[0].messages).toContain("Selling price is required");
  });

  it("rejects an unparseable price", () => {
    const { errors } = validateRows(
      [{ name: "Coca", price: "gratuit" }],
      { name: "name", selling_price: "price" },
      emptyContext
    );
    expect(errors[0].messages[0]).toMatch(/not a valid amount/);
  });

  it("flags a barcode that already exists in the database", () => {
    const { errors } = validateRows(
      [{ name: "Coca", barcode: "611100001", price: "7.00" }],
      { name: "name", barcode: "barcode", selling_price: "price" },
      { categories, existingBarcodes: new Set(["611100001"]) }
    );
    expect(errors[0].messages[0]).toMatch(/already exists/);
  });

  it("flags a barcode duplicated within the file", () => {
    const { rows, errors } = validateRows(
      [
        { name: "Coca", barcode: "611100001", price: "7.00" },
        { name: "Coca again", barcode: "611100001", price: "7.00" },
      ],
      { name: "name", barcode: "barcode", selling_price: "price" },
      emptyContext
    );

    expect(rows).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(errors[0].rowNumber).toBe(3);
    expect(errors[0].messages[0]).toMatch(/more than once/);
  });

  it("rejects an unknown category rather than silently creating one", () => {
    const { errors } = validateRows(
      [{ name: "Coca", category: "Inexistante", price: "7.00" }],
      { name: "name", category: "category", selling_price: "price" },
      emptyContext
    );
    expect(errors[0].messages[0]).toMatch(/Unknown category/);
  });

  it("rejects an invalid unit", () => {
    const { errors } = validateRows(
      [{ name: "Coca", unit: "bouteille", price: "7.00" }],
      { name: "name", unit: "unit", selling_price: "price" },
      emptyContext
    );
    expect(errors[0].messages[0]).toMatch(/must be piece, kg or pack/);
  });

  it("builds an opening delivery when cost and quantity are both present", () => {
    const { rows } = validateRows(
      [{ name: "Coca", price: "7.00", cost: "4.80", qty: "48" }],
      mapping,
      emptyContext
    );

    expect(rows[0].opening).toEqual({ quantity: 48, unit_cost_cents: 480 });
  });

  it("refuses opening stock without a buying price, which would record zero cost", () => {
    const { rows, errors } = validateRows(
      [{ name: "Coca", price: "7.00", cost: "", qty: "48" }],
      mapping,
      emptyContext
    );

    expect(rows).toHaveLength(0);
    expect(errors[0].messages[0]).toMatch(/needs a buying price/);
  });

  it("ignores a cost with no quantity, since cost only moves via a purchase", () => {
    const { rows, errors } = validateRows(
      [{ name: "Coca", price: "7.00", cost: "4.80", qty: "" }],
      mapping,
      emptyContext
    );

    expect(errors).toHaveLength(0);
    expect(rows[0].opening).toBeNull();
  });

  it("keeps valid rows when other rows fail", () => {
    const { rows, errors } = validateRows(
      [
        { name: "Good", price: "7.00" },
        { name: "", price: "7.00" },
        { name: "Also good", price: "3.50" },
      ],
      { name: "name", selling_price: "price" },
      emptyContext
    );

    expect(rows.map((row) => row.product.name)).toEqual(["Good", "Also good"]);
    expect(errors).toHaveLength(1);
  });
});

describe("toCsv", () => {
  const products: Product[] = [
    {
      id: "p1",
      name: "Coca-Cola 33cl",
      barcode: "611100001",
      category_id: "cat-drinks",
      unit: "piece",
      selling_price_cents: 700,
      stock_quantity: 48,
      low_stock_threshold: 24,
      is_low_stock: false,
      active: true,
      current_cost_cents: 480,
    },
  ];

  it("includes the cost column for owners", () => {
    const csv = toCsv(products, categories, true);
    expect(csv).toContain("cost");
    expect(csv).toContain("4.80");
  });

  it("omits the cost column for cashiers", () => {
    const csv = toCsv(products, categories, false);
    expect(csv).not.toContain("cost");
    expect(csv).not.toContain("4.80");
  });

  it("writes the category name rather than its id", () => {
    const csv = toCsv(products, categories, false);
    expect(csv).toContain("Boissons");
    expect(csv).not.toContain("cat-drinks");
  });

  it("round-trips through parseCsv", () => {
    const csv = toCsv(products, categories, false);
    const { rows } = parseCsv(csv);
    expect(rows[0].name).toBe("Coca-Cola 33cl");
    expect(rows[0].selling_price).toBe("7.00");
  });
});
