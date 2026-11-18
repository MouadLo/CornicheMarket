// Deactivates, reactivates and re-invites staff. Runs server-side because it
// uses the service role key (Auth admin API), which must never reach the client.
// Deploy with: supabase functions deploy manage-staff
// SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are injected
// automatically by Supabase. APP_URL is the same secret invite-cashier uses.
//
// Deactivation has two layers, in this order:
//   1. set_staff_active(false) (as the calling owner): from this moment the
//      database refuses EVERY API request of that user (pre-request check), even
//      with a still-valid access token. Their sessions are ended.
//   2. a long Auth ban: no new sign-in, no token refresh.
// If step 2 fails the account is already blocked: the answer says so
// (`partial: true`) and the owner can simply try again.
// Reactivation runs the other way round: lift the ban first (so the person can
// get a token), then clear the block. If the second step fails, nothing is
// usable yet and a retry finishes it.
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APP_URL = Deno.env.get("APP_URL") ?? "http://localhost:8081";

// About 100 years: GoTrue has no "forever", only a duration.
const BAN_DURATION = "876000h";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (status: number, body: object) => Response.json(body, { status, headers: cors });

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return reply(405, { error: "Method not allowed" });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return reply(401, { error: "Missing Authorization header" });

  const caller = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userError } = await caller.auth.getUser();
  if (userError || !userData.user) return reply(401, { error: "Invalid session" });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // The caller must be an ACTIVE owner. Read with the service role so this does
  // not depend on the pre-request check (which would also refuse them).
  const { data: me, error: meError } = await admin
    .from("profiles")
    .select("role, deactivated_at")
    .eq("id", userData.user.id)
    .single();
  if (meError || !me) return reply(403, { error: "Only an owner can manage staff" });
  if (me.deactivated_at) return reply(403, { error: "Account deactivated", code: "PT403" });
  if (me.role !== "owner") return reply(403, { error: "Only an owner can manage staff" });

  const body = await req.json().catch(() => null);
  const action = body?.action;
  const userId = body?.user_id;
  if (!["deactivate", "reactivate", "resend_invite"].includes(action) || !UUID.test(userId ?? "")) {
    return reply(400, { error: "action and user_id are required" });
  }

  const { data: target, error: targetError } = await admin
    .from("profiles")
    .select("id, full_name, role, deactivated_at")
    .eq("id", userId)
    .single();
  if (targetError || !target) return reply(404, { error: "Staff member not found" });

  if (action === "deactivate") {
    // set_staff_active checks owner/self/owner-target rules itself. Called with
    // the caller's own token so it sees auth.uid().
    const { error } = await caller.rpc("set_staff_active", { p_user_id: userId, p_active: false });
    if (error) {
      const status = error.code === "42501" ? 403 : error.code === "P0002" ? 404 : 400;
      return reply(status, { error: error.message });
    }
    const { error: banError } = await admin.auth.admin.updateUserById(userId, {
      ban_duration: BAN_DURATION,
    });
    if (banError) {
      // The database block is already in place: say so, and let the owner retry.
      return reply(502, { error: "ban_failed", partial: true, blocked: true });
    }
    return reply(200, { ok: true });
  }

  if (action === "reactivate") {
    const { error: unbanError } = await admin.auth.admin.updateUserById(userId, {
      ban_duration: "none",
    });
    if (unbanError) return reply(502, { error: "unban_failed", partial: false });
    const { error } = await caller.rpc("set_staff_active", { p_user_id: userId, p_active: true });
    if (error) return reply(502, { error: "unblock_failed", partial: true, blocked: true });
    return reply(200, { ok: true });
  }

  // resend_invite: only for someone who has not accepted yet, and not for a
  // deactivated person (reactivate first).
  if (target.deactivated_at) return reply(400, { error: "Account deactivated" });
  const { data: authUser, error: authUserError } = await admin.auth.admin.getUserById(userId);
  if (authUserError || !authUser.user?.email) return reply(404, { error: "Staff member not found" });
  const u = authUser.user;
  if (u.email_confirmed_at || u.last_sign_in_at) {
    return reply(409, { error: "already_accepted" });
  }
  // GoTrue's invite endpoint re-sends the invitation to a user who has not
  // confirmed yet, and refuses one who has (which was checked above).
  const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(u.email, {
    data: { full_name: target.full_name },
    redirectTo: `${APP_URL}/accept-invite`,
  });
  if (inviteError) return reply(400, { error: inviteError.message });
  return reply(200, { ok: true });
});
