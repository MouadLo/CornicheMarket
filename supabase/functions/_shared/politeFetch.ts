// Polite fetching for the competitor shop functions (Deno only; the pure rules
// live in competitorParse.ts). One fetcher per request: robots.txt is read
// afresh each time (a warm isolate must not keep it), requests to the same host
// are spaced by `gapMs`, we identify ourselves honestly, redirects are followed
// by hand and only to the same site over https. A refusal is never retried or
// worked around.
import { robotsAllowsCatalog, USER_AGENT } from "./competitorParse.ts";

const MAX_REDIRECTS = 3;

export type RawResponse = {
  status: number;
  headers: Headers;
  bytes: Uint8Array;
  location: string | null;
  tooLarge: boolean;
};

export type PoliteResult =
  | { kind: "response"; status: number; headers: Headers; bytes: Uint8Array; finalUrl: string; tooLarge: boolean }
  | { kind: "refused"; detail: string } // robots 401/403/429 or a refusal from the site
  | { kind: "disallowed" } // robots.txt disallows the path
  | { kind: "error"; detail: string };

type RobotsEntry =
  | { kind: "rules"; text: string }
  | { kind: "none" }
  | { kind: "refused"; detail: string }
  | { kind: "error"; detail: string };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const bare = (host: string) => host.replace(/^www\./, "");

export function createPoliteFetcher(options: { gapMs: number; timeoutMs: number; maxBytes: number }) {
  const lastRequestAt = new Map<string, number>();
  const robotsCache = new Map<string, RobotsEntry>();

  async function readBody(res: Response): Promise<{ bytes: Uint8Array; tooLarge: boolean }> {
    if (!res.body) return { bytes: new Uint8Array(), tooLarge: false };
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > options.maxBytes) {
        await reader.cancel().catch(() => {});
        return { bytes: new Uint8Array(), tooLarge: true };
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { bytes, tooLarge: false };
  }

  async function raw(target: string, accept: string): Promise<RawResponse | { error: string }> {
    const host = new URL(target).host;
    const wait = (lastRequestAt.get(host) ?? 0) + options.gapMs - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequestAt.set(host, Date.now());
    try {
      const res = await fetch(target, {
        method: "GET",
        redirect: "manual",
        headers: { "User-Agent": USER_AGENT, Accept: accept, "Accept-Language": "fr,ar;q=0.8,en;q=0.5" },
        signal: AbortSignal.timeout(options.timeoutMs),
      });
      const body = await readBody(res);
      lastRequestAt.set(host, Date.now());
      return { status: res.status, headers: res.headers, bytes: body.bytes, location: res.headers.get("location"), tooLarge: body.tooLarge };
    } catch (error) {
      return { error: error instanceof Error && error.name === "TimeoutError" ? "timeout" : "network" };
    }
  }

  async function robotsFor(target: URL): Promise<RobotsEntry> {
    const cached = robotsCache.get(target.host);
    if (cached) return cached;
    let entry: RobotsEntry;
    let current = `${target.origin}/robots.txt`;
    for (let hop = 0; ; hop++) {
      const res = await raw(current, "text/plain,*/*;q=0.5");
      if ("error" in res) {
        entry = { kind: "error", detail: res.error };
        break;
      }
      if (res.status >= 300 && res.status < 400 && res.location && hop < MAX_REDIRECTS) {
        const next = new URL(res.location, current);
        if (next.protocol !== "https:" || bare(next.host) !== bare(target.host)) {
          entry = { kind: "error", detail: "robots_redirect" };
          break;
        }
        current = next.toString();
        continue;
      }
      if (res.status === 401 || res.status === 403 || res.status === 429) {
        entry = { kind: "refused", detail: `robots_http_${res.status}` };
      } else if (res.status >= 500) {
        entry = { kind: "error", detail: `robots_http_${res.status}` };
      } else if (res.status >= 400) {
        entry = { kind: "none" };
      } else {
        entry = { kind: "rules", text: new TextDecoder().decode(res.bytes.slice(0, 500_000)) };
      }
      break;
    }
    robotsCache.set(target.host, entry);
    return entry;
  }

  // GET `target` if robots.txt allows it. 4xx/5xx statuses are returned as
  // responses: the caller decides what they mean.
  async function get(target: string, accept: string): Promise<PoliteResult> {
    let current = target;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const parsed = new URL(current);
      const robots = await robotsFor(parsed);
      if (robots.kind === "refused") return { kind: "refused", detail: robots.detail };
      if (robots.kind === "error") return { kind: "error", detail: robots.detail };
      if (robots.kind === "rules" && !robotsAllowsCatalog(robots.text, parsed.pathname + parsed.search)) {
        return { kind: "disallowed" };
      }
      const res = await raw(current, accept);
      if ("error" in res) return { kind: "error", detail: res.error };
      if (res.status >= 300 && res.status < 400 && res.location) {
        const next = new URL(res.location, current);
        if (next.protocol !== "https:" || bare(next.host) !== bare(parsed.host)) {
          return { kind: "error", detail: "redirect_elsewhere" };
        }
        current = next.toString();
        continue;
      }
      return { kind: "response", status: res.status, headers: res.headers, bytes: res.bytes, finalUrl: current, tooLarge: res.tooLarge };
    }
    return { kind: "error", detail: "too_many_redirects" };
  }

  return { get };
}

export const textOf = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

export function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
