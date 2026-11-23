import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";

import {
  chunk,
  mergeSigned,
  parseUrlCache,
  pathsToSign,
  pruneCache,
  PHOTO_BUCKET,
  SIGN_CHUNK,
  URL_TTL_SECONDS,
  type UrlCache,
} from "@/src/lib/products/photoRules";

// Signed URLs of product photos. Lists and the Sell grid ask for hundreds of
// photos at once, so: URLs are kept in memory and on the device (AsyncStorage),
// the paths wanted in the same moment are signed in one batch, a URL is renewed
// only when less than a day is left, and a failed or offline renewal keeps what
// is already there. A path is never reused for another picture, so a stored URL
// stays valid for its image.

const STORAGE_KEY = "corniche.productPhotoUrls.v1";

let cache: UrlCache = {};
let loaded: Promise<void> | null = null;
const wanted = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushing: Promise<void> = Promise.resolve();
const listeners = new Set<() => void>();

function load(): Promise<void> {
  loaded ??= AsyncStorage.getItem(STORAGE_KEY)
    .then((raw) => {
      // What the device already holds, without overwriting fresher memory.
      cache = { ...parseUrlCache(raw), ...cache };
    })
    .catch(() => undefined)
    .then(() => {
      listeners.forEach((listener) => listener());
    });
  return loaded;
}

async function persist(): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // The memory copy still works.
  }
}

// The URL known for a path right now (maybe near its end; renewal runs in the
// background), or null.
export function getPhotoUrl(path: string | null | undefined): string | null {
  return (path && cache[path]?.url) || null;
}

async function signMissing(paths: string[]): Promise<void> {
  await load();
  const todo = pathsToSign(paths, cache, Date.now());
  if (todo.length === 0) return;
  // Loaded when a photo is first wanted, so a screen without photos never
  // needs the Supabase client (and tests of such screens need no environment).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { supabase } =
    require("@/src/lib/supabase/client") as typeof import("@/src/lib/supabase/client");
  let changed = false;
  for (const part of chunk(todo, SIGN_CHUNK)) {
    try {
      const { data, error } = await supabase.storage
        .from(PHOTO_BUCKET)
        .createSignedUrls(part, URL_TTL_SECONDS);
      if (error || !data) continue;
      const signed = data.flatMap((row) =>
        row.path && row.signedUrl && !row.error ? [{ path: row.path, url: row.signedUrl }] : []
      );
      if (signed.length > 0) {
        cache = pruneCache(mergeSigned(cache, signed, Date.now()));
        changed = true;
      }
    } catch {
      // Offline or failing: keep whatever is cached.
    }
  }
  if (changed) {
    await persist();
    listeners.forEach((listener) => listener());
  }
}

// Asks for these paths' URLs. Calls made in the same moment (every tile of a
// screen) are signed together.
export function requestPhotoUrls(paths: (string | null | undefined)[]): Promise<void> {
  let added = false;
  for (const path of paths) {
    if (path) {
      wanted.add(path);
      added = true;
    }
  }
  if (!added) return flushing;
  if (!flushTimer) {
    flushTimer = setTimeout(() => {
      flushTimer = null;
      const batch = [...wanted];
      wanted.clear();
      flushing = signMissing(batch).catch(() => undefined);
    }, 0);
  }
  return flushing;
}

// The URL of one photo for a component. Shows the known URL at once and
// renews it in the background; null while unknown (no URL, no photo).
export function usePhotoUrl(path: string | null | undefined): string | null {
  const [, bump] = useState(0);
  useEffect(() => {
    if (!path) return;
    const listener = () => bump((n) => n + 1);
    listeners.add(listener);
    void load();
    void requestPhotoUrls([path]);
    return () => {
      listeners.delete(listener);
    };
  }, [path]);
  return getPhotoUrl(path);
}

// A removed or replaced photo: forget its URL.
export function forgetPhotoUrl(path: string | null | undefined): void {
  if (!path || !cache[path]) return;
  const { [path]: _gone, ...rest } = cache;
  cache = rest;
  void persist();
  listeners.forEach((listener) => listener());
}

// For tests only.
export function __resetPhotoUrlsForTests() {
  cache = {};
  loaded = null;
  wanted.clear();
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  flushing = Promise.resolve();
  listeners.clear();
}
