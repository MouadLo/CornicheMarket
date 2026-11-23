import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  classifyHttp,
  parseProductPage,
  parseShopifyJs,
  parseWooStore,
  planReaders,
  readingChanged,
  robotsAllows,
  USER_AGENT,
  type ParseResult,
  type Reading,
} from "../_shared/competitorParse.ts";

// Reads competitor prices where the site allows it. Two callers:
//   (a) the owner, with their session: { linkId, retry? } checks that link now,
//       at most once per 10 minutes per link;
//   (b) the daily job (pg_cron + pg_net), with header x-cron-secret equal to the
//       COMPETITOR_CHECK_SECRET function secret: checks every `auto` link not
//       fetched in the last 20 hours, one at a time, at least 2 s apart on the
//       same host, and stops after about 4 minutes.
// Rules, in code below: robots.txt is read first and honoured (our agent's
// group, else `*`); we identify as CornicheMarket-price-check; a refusal (robots
// Disallow, 401/403/429/451, a bot challenge) turns the link into `manual` and
// is never retried or worked around; no proxies, no browser spoofing.

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const response = (status: number, body: object) => Response.json(body, { status, headers: cors });

const url = Deno.env.get("SUPABASE_URL")!;
const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const OWNER_MIN_GAP_MS = 10 * 60 * 1000;
const DAILY_MIN_GAP_MS = 20 * 60 * 60 * 1000;
const HOST_GAP_MS = 2000;
const FETCH_TIMEOUT_MS = 12000;
const MAX_BODY_CHARS = 2_000_000;
const MAX_REDIRECTS = 3;
const CRON_BUDGET_MS = 4 * 60 * 1000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---- polite fetching -------------------------------------------------------

const lastRequestAt = new Map<string, number>();
type RobotsEntry = { kind: "rules"; text: string } | { kind: "none" } | { kind: "refused"; detail: string } | { kind: "error"; detail: string };
const robotsCache = new Map<string, RobotsEntry>();

type Fetched =
  | { kind: "ok"; body: string; url: string }
  | { kind: "refused"; detail: string }
  | { kind: "disallowed" }
  | { kind: "error"; detail: string };

// One request, spaced from the previous one to the same host. Redirects are
// followed by hand, only to the same site (a www. variant) over https.
async function rawGet(target: string, accept: string): Promise<{ status: number; body: string; location: string | null } | { error: string }> {
  const host = new URL(target).host;
  const wait = (lastRequestAt.get(host) ?? 0) + HOST_GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt.set(host, Date.now());
  try {
    const res = await fetch(target, {
      method: "GET",
      redirect: "manual",
      headers: { "User-Agent": USER_AGENT, Accept: accept, "Accept-Language": "fr,ar;q=0.8,en;q=0.5" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const body = (await res.text()).slice(0, MAX_BODY_CHARS);
    return { status: res.status, body, location: res.headers.get("location") };
  } catch (error) {
    return { error: error instanceof Error && error.name === "TimeoutError" ? "timeout" : "network" };
  }
}

const bare = (host: string) => host.replace(/^www\./, "");

async function robotsFor(target: URL): Promise<RobotsEntry> {
  const cached = robotsCache.get(target.host);
  if (cached) return cached;
  let entry: RobotsEntry;
  let current = `${target.origin}/robots.txt`;
  for (let hop = 0; ; hop++) {
    const res = await rawGet(current, "text/plain,*/*;q=0.5");
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
      entry = { kind: "none" }; // no robots.txt: nothing is disallowed
    } else {
      entry = { kind: "rules", text: res.body };
    }
    break;
  }
  robotsCache.set(target.host, entry);
  return entry;
}

async function fetchChecked(target: string, accept: string): Promise<Fetched> {
  let current = target;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const parsed = new URL(current);
    const robots = await robotsFor(parsed);
    if (robots.kind === "refused" || robots.kind === "error") return robots;
    if (robots.kind === "rules" && !robotsAllows(robots.text, parsed.pathname + parsed.search)) {
      return { kind: "disallowed" };
    }
    const res = await rawGet(current, accept);
    if ("error" in res) return { kind: "error", detail: res.error };
    if (res.status >= 300 && res.status < 400 && res.location) {
      const next = new URL(res.location, current);
      if (next.protocol !== "https:" || bare(next.host) !== bare(parsed.host)) {
        return { kind: "error", detail: "redirect_elsewhere" };
      }
      current = next.toString();
      continue;
    }
    const verdict = classifyHttp(res.status, res.body);
    if (verdict.kind === "ok") return { kind: "ok", body: res.body, url: current };
    return verdict;
  }
  return { kind: "error", detail: "too_many_redirects" };
}

// ---- reading one link ------------------------------------------------------

type Outcome =
  | { status: "ok"; reading: Reading }
  | { status: "refused" | "unsupported" | "error" | "manual"; detail: string };

async function readLink(linkUrl: string): Promise<Outcome> {
  const plan = planReaders(linkUrl);
  if (plan.manual) return { status: "manual", detail: plan.reason };

  let pageOutcome: Outcome = { status: "error", detail: "no_attempt" };
  for (const reader of plan.readers) {
    const isPage = reader.kind === "page";
    const accept = isPage ? "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5" : "application/json";
    const fetched = await fetchChecked(reader.url, accept);
    let outcome: Outcome;
    if (fetched.kind === "refused") {
      // A refusal ends the check: no other reader, no retry.
      return { status: "refused", detail: fetched.detail };
    } else if (fetched.kind === "disallowed") {
      outcome = { status: "refused", detail: "robots_disallow" };
    } else if (fetched.kind === "error") {
      outcome = { status: "error", detail: fetched.detail };
    } else {
      let parsed: ParseResult;
      try {
        if (reader.kind === "page") parsed = parseProductPage(fetched.body, fetched.url);
        else {
          const json = JSON.parse(fetched.body);
          parsed = reader.kind === "woocommerce"
            ? parseWooStore(json, new URL(reader.url).searchParams.get("slug") ?? undefined)
            : parseShopifyJs(json);
        }
      } catch {
        parsed = { ok: false, status: "unsupported", detail: "bad_json" };
      }
      if (parsed.ok) return { status: "ok", reading: parsed.reading };
      outcome = { status: parsed.status, detail: parsed.detail };
    }
    if (isPage) pageOutcome = outcome;
  }
  return pageOutcome;
}

// ---- storing the result ----------------------------------------------------

type LinkRow = { id: string; url: string; mode: "auto" | "manual"; last_auto_check_at: string | null };
const admin = createClient(url, serviceRole);

async function store(link: LinkRow, outcome: Outcome) {
  const now = new Date().toISOString();
  const values: Record<string, unknown> = {
    last_checked_at: now,
    last_auto_check_at: now,
    last_status: outcome.status,
    last_status_detail: outcome.status === "ok" ? null : outcome.detail,
  };
  // A refusal or an unsupported format makes the link manual for good.
  if (outcome.status === "refused" || outcome.status === "unsupported" || outcome.status === "manual") {
    values.mode = "manual";
    values.last_status = outcome.status === "manual" ? "manual" : outcome.status;
  }
  if (outcome.status === "ok") {
    values.last_ok_at = now;
    values.mode = "auto";
    const { data: latest } = await admin.from("competitor_price_points")
      .select("price_cents,regular_price_cents,in_stock")
      .eq("link_id", link.id).order("observed_at", { ascending: false }).limit(1).maybeSingle();
    const reading = outcome.reading;
    // A point is stored only when something changed.
    if (readingChanged(latest, reading)) {
      const { error } = await admin.from("competitor_price_points").insert({
        link_id: link.id,
        price_cents: reading.priceCents,
        regular_price_cents: reading.regularPriceCents,
        on_sale: reading.onSale,
        in_stock: reading.inStock,
        low_stock_remaining: reading.lowStockRemaining,
        title: reading.title,
        image_url: reading.imageUrl,
        source: "auto",
      });
      if (error) throw new Error(`save_point_failed: ${error.message}`);
    }
  }
  const { error } = await admin.from("competitor_links").update(values).eq("id", link.id);
  if (error) throw new Error(`save_link_failed: ${error.message}`);
}

async function checkAndStore(link: LinkRow): Promise<Outcome> {
  let outcome: Outcome;
  try {
    outcome = await readLink(link.url);
  } catch (error) {
    console.error("check-competitor-prices failed", { link: link.id, message: String(error).slice(0, 300) });
    outcome = { status: "error", detail: "unexpected" };
  }
  try {
    await store(link, outcome);
  } catch (error) {
    // The reading was not saved: say so rather than report an `ok` nobody can see.
    console.error("check-competitor-prices save failed", { link: link.id, message: String(error).slice(0, 300) });
    return { status: "error", detail: "save_failed" };
  }
  return outcome;
}

// ---- entry point -----------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return response(405, { error: "method" });
  // robots.txt is read afresh on every call (a warm isolate must not keep it).
  robotsCache.clear();

  const cronHeader = req.headers.get("x-cron-secret");
  if (cronHeader !== null) {
    const secret = Deno.env.get("COMPETITOR_CHECK_SECRET");
    if (!secret || !sameSecret(cronHeader, secret)) return response(401, { error: "secret" });
    const deadline = Date.now() + CRON_BUDGET_MS;
    const cutoff = new Date(Date.now() - DAILY_MIN_GAP_MS).toISOString();
    const { data: links, error } = await admin.from("competitor_links")
      .select("id,url,mode,last_auto_check_at")
      .eq("mode", "auto")
      .or(`last_auto_check_at.is.null,last_auto_check_at.lt.${cutoff}`)
      .order("last_auto_check_at", { ascending: true, nullsFirst: true })
      .limit(500);
    if (error) return response(503, { error: "temporarily_unavailable" });
    const counts: Record<string, number> = {};
    let checked = 0;
    for (const link of (links ?? []) as LinkRow[]) {
      if (Date.now() > deadline) break;
      const outcome = await checkAndStore(link);
      counts[outcome.status] = (counts[outcome.status] ?? 0) + 1;
      checked++;
    }
    return response(200, { checked, remaining: (links?.length ?? 0) - checked, counts });
  }

  const authorization = req.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return response(401, { error: "session" });
  const caller = createClient(url, anon, { global: { headers: { Authorization: authorization } } });
  const { data: auth, error: authError } = await caller.auth.getUser();
  if (authError || !auth.user) return response(401, { error: "session" });
  const { data: owner, error: ownerError } = await caller.rpc("is_owner");
  if (ownerError?.code === "PT403") return response(403, { error: "account_deactivated", code: "PT403" });
  if (owner !== true) return response(403, { error: "owner_only" });

  const body = await req.json().catch(() => null);
  const linkId = body?.linkId;
  if (typeof linkId !== "string" || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(linkId)) {
    return response(400, { error: "invalid_link" });
  }
  const { data: link, error: linkError } = await admin.from("competitor_links")
    .select("id,url,mode,last_auto_check_at").eq("id", linkId).maybeSingle();
  if (linkError) return response(503, { error: "temporarily_unavailable" });
  if (!link) return response(404, { error: "not_found" });

  // A manual link is not fetched again unless the owner asks for a retry.
  if (link.mode === "manual" && body?.retry !== true) return response(200, { status: "manual", skipped: true });
  if (link.last_auto_check_at && Date.now() - Date.parse(link.last_auto_check_at) < OWNER_MIN_GAP_MS) {
    const retryAfter = Math.ceil((OWNER_MIN_GAP_MS - (Date.now() - Date.parse(link.last_auto_check_at))) / 1000);
    return response(429, { error: "too_soon", retry_after_seconds: retryAfter });
  }
  const outcome = await checkAndStore(link as LinkRow);
  return response(200, outcome.status === "ok"
    ? { status: "ok", reading: outcome.reading }
    : { status: outcome.status, detail: outcome.detail });
});
