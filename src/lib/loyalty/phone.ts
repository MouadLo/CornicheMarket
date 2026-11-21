// The customer's Moroccan mobile number is their loyalty card. Same rule as
// public.normalize_ma_phone on the server: whatever the cashier types, one form
// is stored and looked up, "+212" followed by 9 digits starting 5, 6 or 7.

const E164 = /^\+212[5-7]\d{8}$/;

// null when it is not a Moroccan number. Spaces, dots, dashes and brackets are
// ignored; 06…/07…/05…, +212…, 00212…, 212… and the bare 9 digits are accepted.
export function normalizeMaPhone(input: string): string | null {
  let digits = input.replace(/[\s.\-()]/g, "");
  if (digits.startsWith("+")) digits = `00${digits.slice(1)}`;
  if (!/^\d+$/.test(digits)) return null;
  let national: string;
  if (digits.startsWith("00212")) national = digits.slice(5);
  else if (digits.startsWith("212") && digits.length === 12) national = digits.slice(3);
  else if (digits.startsWith("0") && digits.length === 10) national = digits.slice(1);
  else national = digits;
  const e164 = `+212${national}`;
  return E164.test(e164) ? e164 : null;
}

// "+212612345678" → "06 12 34 56 78", how people read it in Morocco.
export function formatMaPhone(e164: string): string {
  if (!E164.test(e164)) return e164;
  const n = `0${e164.slice(4)}`;
  return `${n.slice(0, 2)} ${n.slice(2, 4)} ${n.slice(4, 6)} ${n.slice(6, 8)} ${n.slice(8)}`;
}

// How to show any stored phone: a Moroccan number in the usual 06 12 34 56 78
// reading, anything else as it was typed.
export function displayPhone(phone: string): string {
  const e164 = normalizeMaPhone(phone);
  return e164 ? formatMaPhone(e164) : phone;
}
