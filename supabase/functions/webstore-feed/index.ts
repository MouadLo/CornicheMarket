import { createClient } from "jsr:@supabase/supabase-js@2";

// Public. The webstore page (a static site) reads the catalogue from here. It
// serves the JSON built by the database function webstore_feed(), which holds no
// cost, stock quantity or any other private column. The service role is used
// only to be allowed to call that function; nothing from the request is used.

const baseHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
  "Content-Type": "application/json; charset=utf-8",
};

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: baseHeaders });
  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "method" }), {
      status: 405,
      headers: { ...baseHeaders, Allow: "GET, OPTIONS", "Cache-Control": "no-store" },
    });
  }

  const { data, error } = await admin.rpc("webstore_feed");
  if (error || !data) {
    return new Response(JSON.stringify({ error: "feed unavailable" }), {
      status: 503,
      headers: { ...baseHeaders, "Cache-Control": "no-store" },
    });
  }
  // An uploaded picture comes from the database as a path relative to the
  // project (migration 057); the page needs the full address.
  const base = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "");
  const feed = data as { products?: { image?: string | null }[] };
  for (const product of feed.products ?? []) {
    if (typeof product.image === "string" && product.image.startsWith("/storage/")) {
      product.image = base + product.image;
    }
  }
  return new Response(JSON.stringify(feed), {
    status: 200,
    headers: { ...baseHeaders, "Cache-Control": "public, max-age=60, s-maxage=60" },
  });
});
