// Name matcher: "their product" -> "our product". Pure (no network, no Deno
// APIs, no imports) so the edge function and jest both use it.
//
// Normalisation: decode HTML entities, lowercase, strip accents, split on
// punctuation, unify units (g/gr/grammes, kg, ml/cl/l; 1.5L = 150cl = 1500ml;
// x4 = 4x = pack de 4), drop stop words (but keep "sans": "sans gluten" matters).
//
// Score (0..1) of two names:
//   base     = 0.65 * dice + 0.35 * containment   over the name tokens (sizes removed)
//   same size                 +0.15
//   a size on one side only   -0.05
//   mass vs volume (360 g vs 37 cl: a jar's weight and volume)  -0.05, "incertain"
//   a different size or pack count of the same kind   VETO (score 0)
//   a variant word on one side only (zero, light, sans, gluten, bio, ...)
//                             -0.10 each (at most 2), "incertain"
// Thresholds: >= HIGH_SCORE (0.80) proposed; between LOW_SCORE (0.50) and HIGH,
// or flagged, proposed "incertain"; < LOW_SCORE: no candidate.

export const HIGH_SCORE = 0.8;
export const LOW_SCORE = 0.5;

const ENTITY_MAP: Record<string, string> = {
  amp: "&", nbsp: " ", quot: '"', apos: "'", eacute: "é", egrave: "è", agrave: "à",
  ecirc: "ê", ccedil: "ç", ocirc: "ô", ucirc: "û", icirc: "î", acirc: "â", euml: "ë",
  iuml: "ï", ouml: "ö", uuml: "ü", ndash: "-", mdash: "-", rsquo: "'", lsquo: "'",
  oelig: "œ", deg: "°", times: "x",
};

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1].toLowerCase() === "x" ? parseInt(body.slice(2), 16) : Number(body.slice(1));
      try {
        return String.fromCodePoint(code);
      } catch {
        return whole;
      }
    }
    return ENTITY_MAP[body.toLowerCase()] ?? whole;
  });
}

// Lowercase, no accents, no entities, single spaces.
export function normalizeName(raw: string): string {
  let text = decode(decode(raw)).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  text = text.replace(/œ/g, "oe").replace(/æ/g, "ae").replace(/[×✕]/g, "x");
  text = text.replace(/[’‘`´]/g, "'").replace(/[–—]/g, " ");
  text = text.replace(/cocacola/g, "coca cola");
  return text.replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Sizes
// ---------------------------------------------------------------------------

export type Size = {
  // grams / millilitres as integers (1.5 L -> 1500), per unit of a multipack
  grams: number | null;
  millilitres: number | null;
  // 4 for "x4", "pack de 4", "4x"; null when the name says nothing
  count: number | null;
};

const NUM = String.raw`\d+(?:[.,]\d+)?`;
const MASS_UNIT = String.raw`(?:kilogrammes?|kilos?|kg|grammes?|gr|g)`;
const VOLUME_UNIT = String.raw`(?:millilitres?|centilitres?|litres?|ml|cl|lt|l)`;
const UNIT = String.raw`(?:${MASS_UNIT}|${VOLUME_UNIT})`;
const END = String.raw`(?![a-z0-9])`;

// "1,5" -> 1500 (thousandths), without floating point.
function toMilli(text: string): number {
  const [whole, fraction = ""] = text.replace(",", ".").split(".");
  return Number(whole) * 1000 + Number((fraction + "000").slice(0, 3));
}

function setUnit(size: Size, amount: string, unit: string): void {
  const milli = toMilli(amount);
  if (/^(kg|kilo|kilos|kilogramme|kilogrammes)$/.test(unit)) size.grams = milli;
  else if (/^(g|gr|gramme|grammes)$/.test(unit)) size.grams = Math.round(milli / 1000);
  else if (/^(l|lt|litre|litres)$/.test(unit)) size.millilitres = milli;
  else if (/^(cl|centilitre|centilitres)$/.test(unit)) size.millilitres = Math.round(milli / 100);
  else size.millilitres = Math.round(milli / 1000); // ml
}

// Extracts the size and pack count and returns the text without them.
export function extractSize(normalized: string): { size: Size; rest: string } {
  const size: Size = { grams: null, millilitres: null, count: null };
  let text = ` ${normalized} `;

  // 6 x 33cl, 6x33 cl : a count and a unit size
  text = text.replace(new RegExp(String.raw`(?<![a-z0-9])(\d{1,3})\s*x\s*(${NUM})\s*(${UNIT})${END}`, "g"),
    (_w, n: string, amount: string, unit: string) => {
      size.count = Number(n);
      setUnit(size, amount, unit);
      return " ";
    });
  // 33cl x 6
  text = text.replace(new RegExp(String.raw`(?<![a-z0-9])(${NUM})\s*(${UNIT})\s*x\s*(\d{1,3})${END}`, "g"),
    (_w, amount: string, unit: string, n: string) => {
      size.count = Number(n);
      setUnit(size, amount, unit);
      return " ";
    });
  // 1.5l, 150 cl, 100 g, 1kg
  text = text.replace(new RegExp(String.raw`(?<![a-z0-9.,])(${NUM})\s*(${UNIT})${END}`, "g"),
    (_w, amount: string, unit: string) => {
      if (/^(kg|kilo|kilos|kilogramme|kilogrammes|g|gr|gramme|grammes)$/.test(unit)) {
        if (size.grams === null) setUnit(size, amount, unit);
      } else if (size.millilitres === null) setUnit(size, amount, unit);
      return " ";
    });
  // pack de 4, lot de 6, pack x4, 4 pieces
  text = text.replace(/(?<![a-z0-9])(?:pack|lot|paquet|coffret|carton)\s*(?:de|of|x)?\s*(\d{1,3})(?![a-z0-9])/g,
    (_w, n: string) => {
      size.count = size.count ?? Number(n);
      return " ";
    });
  text = text.replace(/(?<![a-z0-9])(\d{1,3})\s*(?:pcs|pieces?|unites?|unit|u)(?![a-z0-9])/g, (_w, n: string) => {
    size.count = size.count ?? Number(n);
    return " ";
  });
  // x4, 4x
  text = text.replace(/(?<![a-z0-9])x\s*(\d{1,3})(?![a-z0-9.,])/g, (_w, n: string) => {
    size.count = size.count ?? Number(n);
    return " ";
  });
  text = text.replace(/(?<![a-z0-9.,])(\d{1,3})\s*x(?![a-z0-9])/g, (_w, n: string) => {
    size.count = size.count ?? Number(n);
    return " ";
  });
  // A pack of one is no pack.
  if (size.count === 1) size.count = null;
  return { size, rest: text.replace(/\s+/g, " ").trim() };
}

export type SizeVerdict = "same" | "veto" | "missing" | "mixed" | "none";

// How two sizes compare. A conflict between two sizes of the same kind (or two
// pack counts) is a veto; a size on one side only, or mass against volume, is
// not decisive.
export function compareSizes(a: Size, b: Size): SizeVerdict {
  const hasA = a.grams !== null || a.millilitres !== null || a.count !== null;
  const hasB = b.grams !== null || b.millilitres !== null || b.count !== null;
  if (!hasA && !hasB) return "none";
  if (a.grams !== null && b.grams !== null && a.grams !== b.grams) return "veto";
  if (a.millilitres !== null && b.millilitres !== null && a.millilitres !== b.millilitres) return "veto";
  if (a.count !== null && b.count !== null && a.count !== b.count) return "veto";
  if (!hasA || !hasB) return "missing";
  const sameKind =
    (a.grams !== null && b.grams !== null) || (a.millilitres !== null && b.millilitres !== null);
  if (sameKind) return "same";
  // Only counts on both sides (equal, checked above) also count as the same.
  if (a.count !== null && b.count !== null && a.grams === null && a.millilitres === null &&
      b.grams === null && b.millilitres === null) return "same";
  const aMeasure = a.grams !== null || a.millilitres !== null;
  const bMeasure = b.grams !== null || b.millilitres !== null;
  if (aMeasure && bMeasure) return "mixed"; // mass vs volume
  return "missing";
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

// "sans" is deliberately NOT here.
const STOP_WORDS = new Set([
  "de", "du", "des", "la", "le", "les", "l", "d", "un", "une", "et", "au", "aux", "en", "pour",
  "the", "with", "avec", "of", "and", "a", "for", "by", "par", "sur", "dans",
]);

// Words that make a different product when only one side has them.
const VARIANT_WORDS = new Set([
  "zero", "light", "diet", "sans", "gluten", "sucre", "bio", "organic", "mini", "maxi", "jumbo",
  "vanille", "vanilla", "cherry", "cerise", "citron", "lemon", "fraise", "strawberry", "chocolat",
  "chocolate", "caramel", "menthe", "mint", "lait", "milk", "noir", "dark", "blanc", "white",
  "decaf", "decafeine", "descremee", "ecreme", "entier", "demi", "nature", "epice", "piquant",
  "fort", "doux", "sel", "sale", "vegan", "halal", "xl", "xxl", "family", "familial",
]);

function stem(token: string): string {
  return token.length > 4 && token.endsWith("s") && !token.endsWith("ss") ? token.slice(0, -1) : token;
}

export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  for (const raw of text.split(/[^a-z0-9]+/)) {
    if (!raw || STOP_WORDS.has(raw)) continue;
    const token = stem(raw);
    if (!tokens.includes(token)) tokens.push(token);
  }
  return tokens;
}

export type Prepared = { size: Size; tokens: string[] };

export function prepareName(raw: string): Prepared {
  const { size, rest } = extractSize(normalizeName(raw));
  return { size, tokens: tokenize(rest) };
}

function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (a.length < b.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

// Tokens that are the same word: equal, or a long word one typo/ending apart
// (chocolat/chocolate, mayonaise/mayonnaise).
function sameWord(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length >= 6 && b.length >= 6 && withinOneEdit(a, b)) return 0.85;
  return 0;
}

export type Score = { score: number; uncertain: boolean; size: SizeVerdict };

const round4 = (n: number) => Math.round(n * 10000) / 10000;

export function scorePrepared(a: Prepared, b: Prepared): Score {
  const size = compareSizes(a.size, b.size);
  if (size === "veto") return { score: 0, uncertain: false, size };
  if (a.tokens.length === 0 || b.tokens.length === 0) return { score: 0, uncertain: false, size };

  // greedy pairing of tokens: exact first, then near words
  const usedB = new Set<number>();
  const matchedA = new Set<number>();
  let overlap = 0;
  for (const pass of [1, 0.85]) {
    a.tokens.forEach((ta, i) => {
      if (matchedA.has(i)) return;
      for (let j = 0; j < b.tokens.length; j++) {
        if (usedB.has(j)) continue;
        if (sameWord(ta, b.tokens[j]) === pass) {
          usedB.add(j);
          matchedA.add(i);
          overlap += pass;
          return;
        }
      }
    });
  }
  if (overlap === 0) return { score: 0, uncertain: false, size };

  const dice = (2 * overlap) / (a.tokens.length + b.tokens.length);
  const containment = overlap / Math.min(a.tokens.length, b.tokens.length);
  let score = 0.65 * dice + 0.35 * containment;
  let uncertain = false;

  if (size === "same") score += 0.15;
  else if (size === "missing") score -= 0.05;
  else if (size === "mixed") {
    score -= 0.05;
    uncertain = true;
  }

  // Variant words found on one side only.
  const unmatchedA = a.tokens.filter((_t, i) => !matchedA.has(i));
  const unmatchedB = b.tokens.filter((_t, j) => !usedB.has(j));
  const variants = [...unmatchedA, ...unmatchedB].filter((t) => VARIANT_WORDS.has(t)).length;
  if (variants > 0) {
    score -= 0.1 * Math.min(variants, 2);
    uncertain = true;
  }

  score = Math.max(0, Math.min(1, score));
  return { score: round4(score), uncertain, size };
}

export function scoreNames(ours: string, theirs: string): Score {
  return scorePrepared(prepareName(ours), prepareName(theirs));
}

export type MatchClass = "proposed" | "uncertain" | "none";

export function classify(result: Score): MatchClass {
  if (result.score < LOW_SCORE) return "none";
  return result.score >= HIGH_SCORE && !result.uncertain ? "proposed" : "uncertain";
}

// ---------------------------------------------------------------------------
// A whole catalogue against our products
// ---------------------------------------------------------------------------

export type MatchResult = {
  itemId: string;
  productId: string | null;
  score: number;
  uncertain: boolean;
};

// Each of our products goes to at most one item (the best pair first), each
// item to at most one product. Items left over get productId null ("Vous ne
// l'avez pas"). Products in `excludeProductIds` (already matched in this shop)
// are never proposed. Deterministic: ties are broken by id.
export function matchCatalog(
  items: { id: string; name: string }[],
  products: { id: string; name: string }[],
  excludeProductIds: ReadonlySet<string> = new Set()
): MatchResult[] {
  const candidates = products
    .filter((p) => !excludeProductIds.has(p.id))
    .map((p) => ({ id: p.id, prepared: prepareName(p.name) }));
  const index = new Map<string, number[]>();
  candidates.forEach((c, i) => {
    for (const token of c.prepared.tokens) {
      const bucket = index.get(token);
      if (bucket) bucket.push(i);
      else index.set(token, [i]);
    }
  });

  const pairs: { itemId: string; productId: string; score: number; uncertain: boolean }[] = [];
  for (const item of items) {
    const prepared = prepareName(item.name);
    const seen = new Set<number>();
    for (const token of prepared.tokens) {
      for (const i of index.get(token) ?? []) seen.add(i);
    }
    // Candidates are the products sharing an exact token; a pair that differs
    // only by near words (typos) is not looked for, to keep this fast.
    for (const i of seen) {
      const result = scorePrepared(candidates[i].prepared, prepared);
      if (classify(result) === "none") continue;
      pairs.push({ itemId: item.id, productId: candidates[i].id, score: result.score, uncertain: result.uncertain || result.score < HIGH_SCORE });
    }
  }
  pairs.sort(
    (x, y) =>
      y.score - x.score ||
      (x.itemId < y.itemId ? -1 : x.itemId > y.itemId ? 1 : 0) ||
      (x.productId < y.productId ? -1 : x.productId > y.productId ? 1 : 0)
  );
  const itemTaken = new Map<string, MatchResult>();
  const productTaken = new Set<string>();
  for (const pair of pairs) {
    if (itemTaken.has(pair.itemId) || productTaken.has(pair.productId)) continue;
    itemTaken.set(pair.itemId, {
      itemId: pair.itemId,
      productId: pair.productId,
      score: pair.score,
      uncertain: pair.uncertain,
    });
    productTaken.add(pair.productId);
  }
  return items.map(
    (item) => itemTaken.get(item.id) ?? { itemId: item.id, productId: null, score: 0, uncertain: false }
  );
}
