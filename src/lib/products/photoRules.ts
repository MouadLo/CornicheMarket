// Pure rules of product photos (migration 053): paths, resizing and the signed
// URL cache. No device or network code here, so they are easy to test.

export const PHOTO_BUCKET = "product-photos";
// The longest side of a stored photo, and the JPEG quality it is saved with.
export const PHOTO_MAX_SIDE = 800;
export const PHOTO_QUALITY = 0.8;

// Signed URLs live 7 days; one is renewed once less than a day is left.
export const URL_TTL_SECONDS = 7 * 24 * 60 * 60;
export const REFRESH_BEFORE_MS = 24 * 60 * 60 * 1000;
export const MAX_CACHED_URLS = 1000;
export const SIGN_CHUNK = 100;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// <product_id>/<uuid>.jpg (a new file name for every photo: a path is never
// overwritten, so a cached URL never shows an old picture).
export function buildPhotoPath(productId: string, uuid: string): string {
  return `${productId}/${uuid.toLowerCase()}.jpg`;
}

// The shape set_product_photo accepts for this product.
export function isValidPhotoPath(productId: string, path: string | null | undefined): boolean {
  if (!path) return false;
  const [folder, file, ...rest] = path.split("/");
  if (rest.length > 0 || folder !== productId || !file) return false;
  const match = /^(.*)\.(jpg|png|webp)$/.exec(file);
  return !!match && UUID.test(match[1]);
}

// What to do to a picked picture before it is uploaded: shrink the long side to
// PHOTO_MAX_SIDE (never enlarge). Returns the manipulate actions.
export function resizeActions(
  width: number,
  height: number
): { resize: { width?: number; height?: number } }[] {
  if (!(width > 0) || !(height > 0)) return [{ resize: { width: PHOTO_MAX_SIDE } }];
  if (Math.max(width, height) <= PHOTO_MAX_SIDE) return [];
  return [{ resize: width >= height ? { width: PHOTO_MAX_SIDE } : { height: PHOTO_MAX_SIDE } }];
}

export type UrlEntry = { url: string; expiresAt: number };
export type UrlCache = Record<string, UrlEntry>;

// A cached URL is renewed when it is missing or close to its end.
export function needsRefresh(entry: UrlEntry | undefined, now: number): boolean {
  return !entry || entry.expiresAt - now < REFRESH_BEFORE_MS;
}

// The distinct non-empty paths that have no good URL yet, in the order asked.
export function pathsToSign(
  paths: (string | null | undefined)[],
  cache: UrlCache,
  now: number
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const path of paths) {
    if (!path || seen.has(path)) continue;
    seen.add(path);
    if (needsRefresh(cache[path], now)) out.push(path);
  }
  return out;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// New URLs replace old ones; paths that failed to sign are left as they were.
export function mergeSigned(
  cache: UrlCache,
  signed: { path: string; url: string }[],
  now: number,
  ttlSeconds = URL_TTL_SECONDS
): UrlCache {
  const next = { ...cache };
  for (const { path, url } of signed) {
    if (path && url) next[path] = { url, expiresAt: now + ttlSeconds * 1000 };
  }
  return next;
}

// Keeps the cache bounded: the entries that end last are the newest, so the ones
// that end first go.
export function pruneCache(cache: UrlCache, max = MAX_CACHED_URLS): UrlCache {
  const keys = Object.keys(cache);
  if (keys.length <= max) return cache;
  const keep = keys.sort((a, b) => cache[b].expiresAt - cache[a].expiresAt).slice(0, max);
  return Object.fromEntries(keep.map((key) => [key, cache[key]]));
}

// Reads what was persisted; anything malformed is dropped.
export function parseUrlCache(raw: string | null): UrlCache {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const out: UrlCache = {};
    for (const [path, entry] of Object.entries(parsed as Record<string, unknown>)) {
      const e = entry as Partial<UrlEntry> | null;
      if (e && typeof e.url === "string" && typeof e.expiresAt === "number") {
        out[path] = { url: e.url, expiresAt: e.expiresAt };
      }
    }
    return out;
  } catch {
    return {};
  }
}
