// Where the owner came from when they cross into another section. Only one
// section of the app is mounted at a time, so a screen opened from another
// section (e.g. "Créer le produit" from Concurrents) is alone in its own stack
// and has nothing to go back to. This remembers the previous full location
// (path + search params) at the moment the section changes, so the header can
// offer a back arrow that returns to exactly that place (Concurrents on its
// "À sourcer" tab, not on "Suivis"). Pure: the hook that feeds it lives in
// useNavOrigin.ts.
import { SECTIONS } from "./sections";

export type OriginState = {
  // The location the owner is on now (path + search).
  current: string | null;
  // The last location in a DIFFERENT section; null until they cross sections.
  previous: string | null;
};

export const EMPTY_ORIGIN: OriginState = { current: null, previous: null };

type ParamValue = string | string[] | undefined;

// First path segment: "/products/new?x=1" -> "products". Route groups are
// already dropped from usePathname(); "(app)" is skipped defensively.
export function sectionOf(href: string): string {
  const path = href.split("?")[0].split("#")[0];
  const segments = path.split("/").filter((s) => s && !/^\(.*\)$/.test(s));
  return segments[0] ?? "";
}

// pathname + search params as one href. Dynamic-segment params (e.g. `id`)
// also show up in the params object; they are already in the pathname, so any
// param whose value is a whole path segment is dropped.
export function buildHref(pathname: string, params: Record<string, ParamValue> = {}): string {
  const segments = new Set(pathname.split("/").filter(Boolean).map(safeDecode));
  const pairs: string[] = [];
  for (const [key, raw] of Object.entries(params)) {
    const values = Array.isArray(raw) ? raw : [raw];
    for (const value of values) {
      if (value === undefined || value === "") continue;
      if (segments.has(value)) continue;
      pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
    }
  }
  return pairs.length ? `${pathname}?${pairs.join("&")}` : pathname;
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

// Fold a new location in. The previous location only changes when the section
// changes; moves inside a section just refresh `current` (so its search params,
// like the Concurrents tab, are the latest ones when the owner leaves).
export function recordLocation(state: OriginState, href: string): OriginState {
  if (state.current === href) return state;
  if (state.current === null) return { current: href, previous: null };
  if (sectionOf(state.current) !== sectionOf(href)) {
    return { current: href, previous: state.current };
  }
  return { ...state, current: href };
}

// "/competitors?tab=sourcing" -> { pathname: "/(app)/competitors", params: { tab: "sourcing" } }.
// expo-router leaks a stray `params=[object Object]` into the URL when a nested
// section is opened from a plain string href, so the arrow navigates with this
// object form (the one the rest of the app uses).
export function hrefToLocation(href: string): {
  pathname: string;
  params: Record<string, string>;
} {
  const [path, search = ""] = href.split("#")[0].split("?");
  const params: Record<string, string> = {};
  new URLSearchParams(search).forEach((value, key) => {
    params[key] = value;
  });
  const pathname = path.startsWith("/(app)")
    ? path
    : `/(app)${path.startsWith("/") ? path : `/${path}`}`;
  return { pathname, params };
}

// `fromOrigin`: the href is the real previous location (the history entry right
// before this screen), so going back one step lands exactly on it; otherwise it
// is the section root, used when the origin is unknown (a reloaded page).
export type BackTarget =
  { kind: "none" } | { kind: "stack" } | { kind: "href"; href: string; fromOrigin: boolean };

// What the header arrow of a screen does.
//  - a screen with an earlier screen in its own stack: normal goBack;
//  - the root screen of a section: no arrow;
//  - the first screen of a stack that is not the root (opened from another
//    section, or after a reload): back to the exact previous location when it
//    is in another section, else to the section's root.
export function backTarget(input: {
  inStack: boolean;
  isRoot: boolean;
  pathname: string;
  origin: OriginState;
}): BackTarget {
  if (input.inStack) return { kind: "stack" };
  if (input.isRoot) return { kind: "none" };
  const { previous } = input.origin;
  if (previous && sectionOf(previous) !== sectionOf(input.pathname)) {
    return { kind: "href", href: previous, fromOrigin: true };
  }
  const segment = sectionOf(input.pathname);
  const section = SECTIONS.find((s) => s.segment === segment);
  if (section) return { kind: "href", href: section.route, fromOrigin: false };
  return { kind: "none" };
}

// Tiny module store so the hook that records and the arrow that reads share
// one origin (and the arrow re-renders when it changes).
let state: OriginState = EMPTY_ORIGIN;
const listeners = new Set<() => void>();

export function getOrigin(): OriginState {
  return state;
}

export function trackLocation(href: string): void {
  const next = recordLocation(state, href);
  if (next === state) return;
  state = next;
  listeners.forEach((l) => l());
}

export function subscribeOrigin(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function resetOrigin(): void {
  state = EMPTY_ORIGIN;
  listeners.forEach((l) => l());
}
