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

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return Response.json({ error: "Missing Authorization header" }, { status: 401 });
  }

  // Client scoped to the caller's own JWT, used only to check their role.
  const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData, error: userError } = await callerClient.auth.getUser();
  if (userError || !userData.user) {
    return Response.json({ error: "Invalid session" }, { status: 401 });
  }

  const { data: callerProfile, error: profileError } = await callerClient
    .from("profiles")
    .select("role")
    .eq("id", userData.user.id)
    .single();

  if (profileError || callerProfile?.role !== "owner") {
    return Response.json({ error: "Only an owner can invite cashiers" }, { status: 403 });
  }

  const { email, full_name } = await req.json();
  if (!email || !full_name) {
    return Response.json({ error: "email and full_name are required" }, { status: 400 });
  }

  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
    data: { full_name },
    redirectTo: `${APP_URL}/accept-invite`,
  });

  if (inviteError) {
    return Response.json({ error: inviteError.message }, { status: 400 });
  }

  return Response.json({ ok: true });
});
