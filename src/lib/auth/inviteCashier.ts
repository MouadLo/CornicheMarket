import { supabase } from "@/src/lib/supabase/client";

// The invite-cashier function answers a refusal with a non-2xx status and
// `{ error: "..." }` in the body, which supabase-js hides behind a generic
// "non-2xx" message. Read the body so errorKey() can tell an existing account
// from a permission problem. The text is only ever mapped, never displayed.
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

export async function inviteCashier(email: string, fullName: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke("invite-cashier", {
    body: { email, full_name: fullName },
  });
  if (error) throw new Error(await failureMessage(error));
  if (data?.error) throw new Error(String(data.error));
}
