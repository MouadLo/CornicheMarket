// Invites a cashier by email. Must run server-side: it uses the service
// role key to call the Auth admin API, which must never reach the client.
// Deploy with: supabase functions deploy invite-cashier
// SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are injected
// automatically by Supabase. Set APP_URL yourself:
//   supabase secrets set APP_URL=https://your-app-domain.com
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APP_URL = Deno.env.get("APP_URL") ?? "http://localhost:8081";

// The web app calls this from another origin, so the browser asks first
// (OPTIONS) and only reads an answer that carries these headers.
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (status: number, body: object) => Response.json(body, { status, headers: cors });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") {
    return reply(405, { error: "Method not allowed" });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return reply(401, { error: "Missing Authorization header" });
  }

  // Client scoped to the caller's own JWT, used only to check their role.
  const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData, error: userError } = await callerClient.auth.getUser();
  if (userError || !userData.user) {
    return reply(401, { error: "Invalid session" });
  }

  const { data: callerProfile, error: profileError } = await callerClient
    .from("profiles")
    .select("role, deactivated_at")
    .eq("id", userData.user.id)
    .single();

  // A deactivated user is refused by the database before this query runs
  // (PT403); the column check is the same rule if that ever changes.
  if (profileError?.code === "PT403" || callerProfile?.deactivated_at) {
    return reply(403, { error: "Account deactivated", code: "PT403" });
  }
  if (profileError || callerProfile?.role !== "owner") {
    return reply(403, { error: "Only an owner can invite cashiers" });
  }

  const { email, full_name } = await req.json();
  if (!email || !full_name) {
    return reply(400, { error: "email and full_name are required" });
  }

  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
    data: { full_name },
    redirectTo: `${APP_URL}/accept-invite`,
  });

  if (inviteError) {
    return reply(400, { error: inviteError.message });
  }

  return reply(200, { ok: true });
});
