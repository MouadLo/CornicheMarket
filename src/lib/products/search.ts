// Ranking for the Sell search box: what the cashier means by "co" is Coca-Cola
// before "Barre chocolatee" (which only contains it), whatever the alphabet says.

export type Searchable = { name: string; barcode?: string | null };

// Lower case without accents, so "epicerie" finds "Épicerie" and "cafe" finds "Café".
export function normalizeSearch(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

const WORD_BREAK = /[\s\-_'’/().,]+/;

// 0 = best. null = no match. A barcode is matched from its start, as the
// server search does, and ranks with a name that starts with the query.
export function searchRank(item: Searchable, query: string): number | null {
  const q = normalizeSearch(query);
  if (!q) return null;
  const name = normalizeSearch(item.name);
  if (name === q) return 0;
  if (name.startsWith(q)) return 1;
  if ((item.barcode ?? "").startsWith(query.trim())) return 1;
  if (name.split(WORD_BREAK).some((word) => word.startsWith(q))) return 2;
  if (name.includes(q)) return 3;
  return null;
}

// Matching products, best first, alphabetical within the same rank.
export function rankBySearch<T extends Searchable>(items: T[], query: string): T[] {
  return items
    .map((item) => ({ item, rank: searchRank(item, query) }))
    .filter((entry): entry is { item: T; rank: number } => entry.rank !== null)
    .sort(
      (a, b) =>
        a.rank - b.rank || normalizeSearch(a.item.name).localeCompare(normalizeSearch(b.item.name))
    )
    .map((entry) => entry.item);
}
