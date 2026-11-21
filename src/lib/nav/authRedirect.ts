// Where the navigation guard sends the visitor, or null to leave them where
// they are. Pages outside the signed-in app that anyone may open:
//   * sign-in and accept-invite (as before);
//   * card: the customer's digital card, for a signed-out visitor AND for a
//     signed-in staff member, who must not be bounced to the Sell screen.
export function authRedirect(
  session: unknown,
  segments: readonly string[]
): "/sign-in" | "/(app)/sell" | null {
  const first = segments[0];
  if (first === "card") return null;
  const onSignIn = first === "sign-in";
  const onAcceptInvite = first === "accept-invite";
  const inApp = first === "(app)";

  if (!session && !onSignIn && !onAcceptInvite) return "/sign-in";
  // Covers arriving at /sign-in while already signed in AND landing on the bare
  // index route (no segments) with a persisted session, e.g. a web user
  // reloading or bookmarking "/": nothing else would move them off it.
  if (session && !inApp && !onAcceptInvite) return "/(app)/sell";
  return null;
}
