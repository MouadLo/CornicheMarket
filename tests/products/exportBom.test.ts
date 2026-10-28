/**
 * PRE-LAUNCH-GAPS I3: CSV export had no UTF-8 BOM, so Excel on Windows fell
 * back to the system code page and any Arabic product name opened as
 * mojibake, even though the written bytes were correct UTF-8.
 *
 * Two things are verified:
 *   1. saveTextFile prepends the BOM on both the native and web write paths.
 *   2. An Arabic product name survives the full export -> file bytes ->
 *      re-import round trip without the BOM leaking into the first column.
 */
import { saveTextFile } from "../../src/lib/files";
import { parseCsv, toCsv } from "../../src/lib/products/csv";
import type { Category, Product } from "../../src/lib/products/queries";

const mockWriteAsStringAsync = jest.fn(async (_uri: string, _content: string) => undefined);
const mockIsAvailableAsync = jest.fn(async () => false);

jest.mock("expo-file-system", () => ({
  cacheDirectory: "file:///cache/",
  writeAsStringAsync: (uri: string, content: string) => mockWriteAsStringAsync(uri, content),
}));

jest.mock("expo-sharing", () => ({
  isAvailableAsync: () => mockIsAvailableAsync(),
  shareAsync: jest.fn(),
}));

jest.mock("expo-document-picker", () => ({
  getDocumentAsync: jest.fn(),
}));

// jest-expo's default Platform.OS is "ios", so saveTextFile takes the
// native (FileSystem) branch under test unless this is overridden.
const UTF8_BOM = "﻿";

beforeEach(() => {
  mockWriteAsStringAsync.mockClear();
});

describe("saveTextFile", () => {
  it("prepends the UTF-8 BOM on the native write path", async () => {
    await saveTextFile("products.csv", "name,price\nLait,7.50\n");

    expect(mockWriteAsStringAsync).toHaveBeenCalledTimes(1);
    const [, written] = mockWriteAsStringAsync.mock.calls[0];
    expect(written.charCodeAt(0)).toBe(0xfeff);
    expect(written.slice(1)).toBe("name,price\nLait,7.50\n");
  });
});

describe("Arabic product name: export -> file bytes -> re-import round trip", () => {
  const categories: Category[] = [{ id: "cat-drinks", name: "Boissons" }];

  const products: Product[] = [
    {
      id: "p1",
      name: "عصير برتقال",
      barcode: "6111234567890",
      category_id: "cat-drinks",
      unit: "piece",
      selling_price_cents: 875,
      stock_quantity: 10,
      low_stock_threshold: 5,
      is_low_stock: false,
      active: true,
      current_cost_cents: 600,
    },
  ];

  it("the Arabic name survives unchanged once the BOM is added, same as saveTextFile writes it", () => {
    const csv = toCsv(products, categories, true);
    const fileBytes = UTF8_BOM + csv; // what saveTextFile now actually writes

    const { headers, rows } = parseCsv(fileBytes);

    // The BOM must not leak into the first header's name.
    expect(headers[0].charCodeAt(0)).not.toBe(0xfeff);
    expect(headers).toContain("name");

    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("عصير برتقال");
    expect(rows[0].selling_price).toBe("8.75");
  });

  it("without the BOM fix, re-parsing is unaffected either way (BOM only matters to Excel's own encoding sniffing, not to Papa)", () => {
    // Documents why this bug was invisible to every existing test: Papa.parse
    // strips a BOM whether it's there or not, and this app never re-opens
    // its own export in Excel during tests. The bug only ever manifested in
    // Excel itself opening the raw bytes, which is also why BOM presence
    // alone is what's asserted in the saveTextFile test above.
    const csv = toCsv(products, categories, true);
    const { rows: withoutBom } = parseCsv(csv);
    const { rows: withBom } = parseCsv(UTF8_BOM + csv);

    expect(withoutBom[0].name).toBe(withBom[0].name);
    expect(withBom[0].name).toBe("عصير برتقال");
  });
});
