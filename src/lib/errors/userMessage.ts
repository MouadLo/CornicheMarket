// Turns anything a query or RPC can throw into a translation key. The server's
// own text ("duplicate key value violates unique constraint ...", "Only the
// owner can ...") is English and technical: it must never reach the screen.
// Unknown messages get the generic key, never the raw text.
//
// The queries throw `new Error(error.message)`, so the message is what we have;
// when an error also carries a Postgres code (InvoiceApprovalError) it is used
// as a second signal. Messages come from supabase/migrations (`raise exception`).

export const ERROR_KEYS = {
  network: "errors.network",
  busy: "errors.busy",
  sessionExpired: "errors.sessionExpired",
  emailTaken: "errors.emailTaken",
  permission: "errors.permission",
  notYours: "errors.notYours",
  dayClosed: "errors.dayClosed",
  duplicateBarcode: "errors.duplicateBarcode",
  duplicateName: "errors.duplicateName",
  duplicateInvoice: "errors.duplicateInvoice",
  duplicate: "errors.duplicate",
  alreadyRecorded: "errors.alreadyRecorded",
  changedElsewhere: "errors.changedElsewhere",
  notFound: "errors.notFound",
  diversItem: "errors.diversItem",
  invalidEntry: "errors.invalidEntry",
  generic: "errors.generic",
} as const;

function messageOf(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "";
}

function codeOf(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return "";
}

// The request never got an answer: no connection, a timeout, or a gateway that
// could not reach the database (the sale queue prefixes 502/503/504).
const NETWORK =
  /failed to fetch|network request failed|networkerror|network error|load failed|fetch failed|timed? ?out|aborted|offline|internet|econn|enotfound|socket hang up|^50[234]\b|bad gateway|service unavailable|gateway time-?out|failed to send a request/i;

export function isNetworkError(error: unknown): boolean {
  return NETWORK.test(messageOf(error));
}

export function isNetworkKey(key: string): boolean {
  return key === ERROR_KEYS.network;
}

export function errorKey(error: unknown): string {
  const message = messageOf(error);
  const m = message.toLowerCase();
  const code = codeOf(error);

  if (NETWORK.test(message)) return ERROR_KEYS.network;

  if (
    /authentication required|authenticated staff required|invalid session|missing authorization|jwt (expired|invalid)|invalid jwt|not authenticated|refresh token/.test(
      m
    ) ||
    code === "PGRST301"
  ) {
    return ERROR_KEYS.sessionExpired;
  }

  if (/already (been )?registered|email.*already|already.*email/.test(m)) {
    return ERROR_KEYS.emailTaken;
  }

  if (/too many requests|rate limit/.test(m) || code === "429") return ERROR_KEYS.busy;

  if (/day is (already )?closed/.test(m)) return ERROR_KEYS.dayClosed;

  // Unique-constraint violations: say which thing is already taken.
  if (/duplicate key|unique constraint/.test(m) || code === "23505") {
    if (/barcode/.test(m)) return ERROR_KEYS.duplicateBarcode;
    if (/invoice_drafts_supplier_number|invoice/.test(m)) return ERROR_KEYS.duplicateInvoice;
    if (/_name_key|categories_code_unique|name/.test(m)) return ERROR_KEYS.duplicateName;
    if (/already pending/.test(m)) return ERROR_KEYS.alreadyRecorded;
    return ERROR_KEYS.duplicate;
  }

  // The operation already happened (or is no longer possible because it did).
  if (
    /already (voided|approved|decided|been decided|saved|used|recorded|pending)|was voided|voided delivery|different details|another payload|conflicts with payment/.test(
      m
    ) ||
    code === "CM410" ||
    code === "CM413"
  ) {
    return ERROR_KEYS.alreadyRecorded;
  }

  // Somebody else changed it first: reload before trying again.
  if (
    /draft (has )?changed|has changed|changed elsewhere/.test(m) ||
    code === "CM409" ||
    code === "CM412"
  ) {
    return ERROR_KEYS.changedElsewhere;
  }

  if (/another user|your own sales/.test(m)) return ERROR_KEYS.notYours;

  if (
    /only (the|an) owner|owner only|permission denied|row-level security|not authorized|insufficient privilege/.test(
      m
    ) ||
    code === "42501"
  ) {
    return ERROR_KEYS.permission;
  }

  if (/divers/.test(m)) return ERROR_KEYS.diversItem;

  if (/not found|unknown (delivery|supplier|product|reason)/.test(m) || code === "P0002") {
    return ERROR_KEYS.notFound;
  }

  // The server refused the values themselves (migration SQLSTATE 22023).
  if (code === "22023" || code === "check_violation" || code === "CM414") {
    return ERROR_KEYS.invalidEntry;
  }

  // Same refusal, but the code did not survive `new Error(error.message)`.
  if (
    /invalid|cannot exceed|must be|needs |(is|are) required|not a real date|days ago|in the future|whole units|at most/.test(
      m
    )
  ) {
    return ERROR_KEYS.invalidEntry;
  }

  return ERROR_KEYS.generic;
}

// For an action with its own specific wording ("Could not save the product"):
// a recognised cause wins, otherwise the screen's own text is used. Never the
// server's text.
export function errorKeyOr(error: unknown, fallbackKey: string): string {
  const key = errorKey(error);
  return key === ERROR_KEYS.generic ? fallbackKey : key;
}
