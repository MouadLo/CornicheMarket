// Turns what a loyalty call can throw into a translation key. The server's own
// text is English and technical and never reaches the screen.
import { errorKeyOr } from "@/src/lib/errors/userMessage";

export function loyaltyErrorKey(error: unknown, fallbackKey = "loyalty.errGeneric"): string {
  const message =
    error && typeof error === "object" && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : typeof error === "string"
        ? error
        : "";
  const m = message.toLowerCase();
  if (/valid moroccan phone/.test(m)) return "loyalty.errPhone";
  if (/agree to join/.test(m)) return "loyalty.errConsent";
  if (/not a loyalty member/.test(m)) return "loyalty.errNotMember";
  if (/adjustment cannot be zero|note of 1 to 200/.test(m)) return "loyalty.errAdjust";
  if (/name is too long/.test(m)) return "loyalty.errNameLong";
  return errorKeyOr(error, fallbackKey);
}
