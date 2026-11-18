import type { Role } from "@/src/lib/auth/AuthProvider";
import { supabase } from "@/src/lib/supabase/client";

// The owner's staff list (migration 040 + the manage-staff Edge Function).
// Nobody is ever deleted: deactivating blocks the account, the name stays on
// every past sale.

export type StaffStatus = "active" | "pending" | "deactivated";

export type StaffMember = {
  id: string;
  fullName: string;
  role: Role;
  email: string;
  inviteAccepted: boolean;
  lastSignInAt: string | null;
  deactivatedAt: string | null;
  status: StaffStatus;
};

type StaffRow = {
  id: string;
  full_name: string;
  role: Role;
  email: string | null;
  invite_accepted: boolean;
  last_sign_in_at: string | null;
  deactivated_at: string | null;
};

// Deactivated wins over everything; someone who never accepted is "pending".
export function staffStatus(row: {
  deactivatedAt: string | null;
  inviteAccepted: boolean;
}): StaffStatus {
  if (row.deactivatedAt) return "deactivated";
  return row.inviteAccepted ? "active" : "pending";
}

export type StaffAction = "deactivate" | "reactivate" | "resend_invite";

// Which buttons a row gets. None for owners and for yourself (the server
// refuses them too); a deactivated person can only be reactivated; a pending
// invitation can be re-sent or cancelled by deactivating.
export function staffActions(member: StaffMember, selfId: string | null): StaffAction[] {
  if (member.role === "owner" || member.id === selfId) return [];
  if (member.status === "deactivated") return ["reactivate"];
  if (member.status === "pending") return ["resend_invite", "deactivate"];
  return ["deactivate"];
}

export function toStaffMember(row: StaffRow): StaffMember {
  const member = {
    id: row.id,
    fullName: row.full_name,
    role: row.role,
    email: row.email ?? "",
    inviteAccepted: row.invite_accepted,
    lastSignInAt: row.last_sign_in_at,
    deactivatedAt: row.deactivated_at,
  };
  return { ...member, status: staffStatus(member) };
}

export async function fetchStaff(): Promise<StaffMember[]> {
  const { data, error } = await supabase.rpc("list_staff");
  if (error) throw new Error(error.message);
  return ((data ?? []) as StaffRow[]).map(toStaffMember);
}

// The function answers a refusal with a non-2xx status and `{ error }`, which
// supabase-js hides behind a generic message: read the body so errorKey() can
// tell a partial failure from a permission problem. Only ever mapped, never shown.
async function failureMessage(error: { message: string; context?: unknown }): Promise<string> {
  const context = error.context as { json?: () => Promise<unknown> } | undefined;
  try {
    const body = (await context?.json?.()) as { error?: unknown } | undefined;
    if (typeof body?.error === "string") return body.error;
  } catch {
    // Not JSON: the generic message is all there is.
  }
  return error.message;
}

async function manage(action: StaffAction, userId: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke("manage-staff", {
    body: { action, user_id: userId },
  });
  if (error) throw new Error(await failureMessage(error));
  if (data?.error) throw new Error(String(data.error));
}

export const deactivateStaff = (userId: string) => manage("deactivate", userId);
export const reactivateStaff = (userId: string) => manage("reactivate", userId);
export const resendStaffInvite = (userId: string) => manage("resend_invite", userId);
