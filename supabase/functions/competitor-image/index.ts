import { createClient } from "jsr:@supabase/supabase-js@2";
import { imageExtension, isAllowedImageType, parseHttpsUrl, isPrivateHost } from "../_shared/competitorParse.ts";
import { corsHeaders, createPoliteFetcher } from "../_shared/politeFetch.ts";

// Owner only. Lets the owner download a competitor's product photo.
// Competitor image hosts do not allow cross-origin downloads from a browser, so
// the app asks this function for the bytes. It is NOT a proxy: the URL must be
// one that is already stored in our database (a catalogue item or a price
// point), robots.txt of the image host is honoured, we identify ourselves
// honestly, redirects only stay on the same site, only image/* of a known type is
// returned and at most 5 MB. Nothing is stored server-side.
// Answer: { contentType, extension, base64 } (JSON, so every client decodes it the same way).

const response = (status: number, body: object) => Response.json(body, { status, headers: corsHeaders });

const url = Deno.env.get("SUPABASE_URL")!;
const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(url, serviceRole);

const MAX_BYTES = 5 * 1024 * 1024;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return response(405, { error: "method" });

  const authorization = req.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return response(401, { error: "session" });
  const caller = createClient(url, anon, { global: { headers: { Authorization: authorization } } });
  const { data: auth, error: authError } = await caller.auth.getUser();
  if (authError || !auth.user) return response(401, { error: "session" });
  const { data: owner, error: ownerError } = await caller.rpc("is_owner");
  if (ownerError?.code === "PT403") return response(403, { error: "account_deactivated", code: "PT403" });
  if (owner !== true) return response(403, { error: "owner_only" });

  const body = await req.json().catch(() => null);
  const parsed = typeof body?.url === "string" ? parseHttpsUrl(body.url) : null;
  if (!parsed || parsed.toString().length > 2000 || isPrivateHost(parsed.hostname)) {
    return response(400, { error: "invalid_url" });
  }
  const target = parsed.toString();

  // The URL must already be in our database, exactly as stored.
  const [item, point] = await Promise.all([
    admin.from("competitor_catalog_items").select("id").eq("image_url", body.url).limit(1),
    admin.from("competitor_price_points").select("id").eq("image_url", body.url).limit(1),
  ]);
  if (item.error || point.error) return response(503, { error: "temporarily_unavailable" });
  if ((item.data?.length ?? 0) === 0 && (point.data?.length ?? 0) === 0) {
    return response(404, { error: "unknown_image" });
  }

  const fetcher = createPoliteFetcher({ gapMs: 1000, timeoutMs: 15000, maxBytes: MAX_BYTES });
  const res = await fetcher.get(target, "image/avif,image/webp,image/png,image/jpeg,image/gif,*/*;q=0.1");
  if (res.kind === "refused") return response(200, { status: "refused", detail: res.detail });
  if (res.kind === "disallowed") return response(200, { status: "refused", detail: "robots_disallow" });
  if (res.kind === "error") return response(200, { status: "error", detail: res.detail });
  if (res.status === 401 || res.status === 403 || res.status === 429 || res.status === 451) {
    return response(200, { status: "refused", detail: `http_${res.status}` });
  }
  if (res.status < 200 || res.status >= 300) return response(200, { status: "error", detail: `http_${res.status}` });
  if (res.tooLarge) return response(200, { status: "error", detail: "too_large" });
  const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!isAllowedImageType(contentType)) return response(200, { status: "error", detail: "not_an_image" });
  return response(200, {
    status: "ok",
    contentType,
    extension: imageExtension(contentType),
    base64: toBase64(res.bytes),
  });
});
