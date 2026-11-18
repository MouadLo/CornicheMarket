import {
  ERROR_KEYS,
  errorKey,
  errorKeyOr,
  isNetworkError,
  isNetworkKey,
} from "../../src/lib/errors/userMessage";

const withCode = (message: string, code: string) => Object.assign(new Error(message), { code });

describe("errorKey", () => {
  it.each([
    ["TypeError: Failed to fetch", ERROR_KEYS.network],
    ["Network request failed", ERROR_KEYS.network],
    ["Load failed", ERROR_KEYS.network],
    ["The operation timed out", ERROR_KEYS.network],
    ["503 upstream connect error", ERROR_KEYS.network],
    ["Failed to send a request to the Edge Function", ERROR_KEYS.network],
    ["Invalid session", ERROR_KEYS.sessionExpired],
    ["Only an owner can invite cashiers", ERROR_KEYS.permission],
    ["email and full_name are required", ERROR_KEYS.invalidEntry],
    ["A user with this email address has already been registered", ERROR_KEYS.emailTaken],
    ["Authentication required", ERROR_KEYS.sessionExpired],
    ["Authenticated staff required", ERROR_KEYS.sessionExpired],
    ["JWT expired", ERROR_KEYS.sessionExpired],
    ["Too many requests", ERROR_KEYS.busy],
    ["The day is closed", ERROR_KEYS.dayClosed],
    ["This day is already closed", ERROR_KEYS.dayClosed],
    [
      'duplicate key value violates unique constraint "idx_products_barcode"',
      ERROR_KEYS.duplicateBarcode,
    ],
    [
      'duplicate key value violates unique constraint "categories_name_key"',
      ERROR_KEYS.duplicateName,
    ],
    [
      'duplicate key value violates unique constraint "invoice_drafts_supplier_number"',
      ERROR_KEYS.duplicateInvoice,
    ],
    ['duplicate key value violates unique constraint "x_pkey"', ERROR_KEYS.duplicate],
    ["This sale is already voided", ERROR_KEYS.alreadyRecorded],
    ["This request has already been decided", ERROR_KEYS.alreadyRecorded],
    ["A void request is already pending for this sale", ERROR_KEYS.alreadyRecorded],
    ["Operation ID already used with another payload", ERROR_KEYS.alreadyRecorded],
    ["This delivery was already saved with different details", ERROR_KEYS.alreadyRecorded],
    ["This invoice was already approved with different details", ERROR_KEYS.alreadyRecorded],
    ["This delivery was voided", ERROR_KEYS.alreadyRecorded],
    ["The invoice draft has changed", ERROR_KEYS.changedElsewhere],
    ["A selected product or its stock unit has changed", ERROR_KEYS.changedElsewhere],
    ["This sale was rung up by another user", ERROR_KEYS.notYours],
    ["You can only ask about your own sales", ERROR_KEYS.notYours],
    ["Only the owner can receive deliveries", ERROR_KEYS.permission],
    ["Only an owner can close the day", ERROR_KEYS.permission],
    ["Reports are owner only", ERROR_KEYS.permission],
    ['new row violates row-level security policy for table "products"', ERROR_KEYS.permission],
    ["Account deactivated", ERROR_KEYS.accountDeactivated],
    ["User is banned", ERROR_KEYS.accountDeactivated],
    ["ban_failed", ERROR_KEYS.staffPartial],
    ["unblock_failed", ERROR_KEYS.staffPartial],
    ["You cannot deactivate your own account", ERROR_KEYS.staffProtected],
    ["An owner account cannot be deactivated", ERROR_KEYS.staffProtected],
    ["already_accepted", ERROR_KEYS.inviteAccepted],
    ["Staff member not found", ERROR_KEYS.notFound],
    ["The Divers item cannot be deleted", ERROR_KEYS.diversItem],
    ["Sale not found", ERROR_KEYS.notFound],
    ["Unknown supplier", ERROR_KEYS.notFound],
    ["Invalid selling price", ERROR_KEYS.invalidEntry],
    ["Pieces and packs must be received as whole units", ERROR_KEYS.invalidEntry],
    ["Delivery date 2030-01-01 is in the future", ERROR_KEYS.invalidEntry],
  ])("%s -> %s", (message, key) => {
    expect(errorKey(new Error(message))).toBe(key);
  });

  it.each([
    ["x", "42501", ERROR_KEYS.permission],
    ["x", "23505", ERROR_KEYS.duplicate],
    ["x", "P0002", ERROR_KEYS.notFound],
    ["x", "22023", ERROR_KEYS.invalidEntry],
    ["x", "CM409", ERROR_KEYS.changedElsewhere],
    ["x", "CM412", ERROR_KEYS.changedElsewhere],
    ["x", "CM410", ERROR_KEYS.alreadyRecorded],
    ["x", "CM413", ERROR_KEYS.alreadyRecorded],
    ["x", "CM414", ERROR_KEYS.invalidEntry],
    ["x", "PGRST301", ERROR_KEYS.sessionExpired],
    ["x", "PT403", ERROR_KEYS.accountDeactivated],
  ])("code %s/%s -> %s", (message, code, key) => {
    expect(errorKey(withCode(message, code))).toBe(key);
  });

  it("never lets unknown or technical server text through", () => {
    for (const raw of [
      'relation "products" does not exist',
      'syntax error at or near "select"',
      "something unexpected",
      "",
    ]) {
      expect(errorKey(new Error(raw))).toBe(ERROR_KEYS.generic);
    }
    expect(errorKey(undefined)).toBe(ERROR_KEYS.generic);
    expect(errorKey(null)).toBe(ERROR_KEYS.generic);
    expect(errorKey(42)).toBe(ERROR_KEYS.generic);
    expect(errorKey({})).toBe(ERROR_KEYS.generic);
  });

  it("accepts plain strings and error-like objects", () => {
    expect(errorKey("Failed to fetch")).toBe(ERROR_KEYS.network);
    expect(errorKey({ message: "The day is closed" })).toBe(ERROR_KEYS.dayClosed);
  });

  it("errorKeyOr keeps the screen's own wording only for unrecognised causes", () => {
    expect(errorKeyOr(new Error("boom"), "products.formSaveError")).toBe("products.formSaveError");
    expect(errorKeyOr(new Error("Failed to fetch"), "products.formSaveError")).toBe(
      ERROR_KEYS.network
    );
  });

  it("flags network failures only", () => {
    expect(isNetworkError(new Error("Failed to fetch"))).toBe(true);
    expect(isNetworkError(new Error("Only the owner can do that"))).toBe(false);
    expect(isNetworkKey(ERROR_KEYS.network)).toBe(true);
    expect(isNetworkKey(ERROR_KEYS.generic)).toBe(false);
  });
});
