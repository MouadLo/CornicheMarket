// What a deactivated account looks like from the app's side. The database
// refuses EVERY API request of a deactivated user with SQLSTATE PT403 (HTTP
// 403, message "Account deactivated", migration 040); the Auth server refuses
// their sign-in and token refresh as "User is banned" (code user_banned); our
// Edge Functions answer the same 403 + PT403. All of those mean one thing.

export const DEACTIVATED_CODE = "PT403";

const DEACTIVATED_MESSAGE = /account deactivated|account_deactivated|user is banned|user_banned/i;

export function isDeactivatedError(error: unknown): boolean {
  if (typeof error === "string") return DEACTIVATED_MESSAGE.test(error);
  if (!error || typeof error !== "object") return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (code === DEACTIVATED_CODE || code === "user_banned") return true;
  return typeof message === "string" && DEACTIVATED_MESSAGE.test(message);
}

// Any request, from any screen or background loop, can be the one that finds
// out. The Supabase client reports it here (see deactivationAwareFetch) and the
// AuthProvider turns it into the full-screen "deactivated" state.
type Listener = () => void;
const listeners = new Set<Listener>();

export function onDeactivated(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyDeactivated(): void {
  for (const listener of [...listeners]) listener();
}

// Wraps fetch for the Supabase client: a 403 whose body carries the
// deactivation code is reported, and the response is passed on untouched.
export async function deactivationAwareFetch(
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1]
): Promise<Response> {
  const response = await fetch(input, init);
  if (response.status === 403) {
    try {
      const body = (await response.clone().json()) as {
        code?: unknown;
        message?: unknown;
        error?: unknown;
      };
      if (
        isDeactivatedError({
          code: body?.code,
          message: typeof body?.message === "string" ? body.message : body?.error,
        })
      ) {
        notifyDeactivated();
      }
    } catch {
      // Not JSON: nothing to read.
    }
  }
  return response;
}
