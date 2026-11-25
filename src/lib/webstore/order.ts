// Moving a row up or down in an owner-ordered list (categories, sub-categories).
// Pure: returns the `sort` writes to make, the caller does them.

export type SortUpdate = { key: string; sort: number };

// Moves `key` one place (`dir` -1 = up, +1 = down). Returns the writes, or []
// when it cannot move (unknown key, already first or last).
//  - The two neighbours have different `sort` values: swap them (two writes).
//  - They have the same value (rows seeded or imported with sort 0): swapping
//    would change nothing, so every row whose value differs from index*10 in
//    the new order is rewritten.
export function moveSorts(
  rows: readonly { key: string; sort: number }[],
  key: string,
  dir: -1 | 1
): SortUpdate[] {
  const from = rows.findIndex((r) => r.key === key);
  const to = from + dir;
  if (from < 0 || to < 0 || to >= rows.length) return [];
  const a = rows[from];
  const b = rows[to];
  if (a.sort !== b.sort) {
    return [
      { key: a.key, sort: b.sort },
      { key: b.key, sort: a.sort },
    ];
  }
  const next = [...rows];
  next[from] = b;
  next[to] = a;
  return next
    .map((r, i) => ({ key: r.key, sort: i * 10, was: r.sort }))
    .filter((r) => r.sort !== r.was)
    .map(({ key: k, sort }) => ({ key: k, sort }));
}
