// The digital card: a page at /card/<token> whose QR holds that same URL, so
// the counter scanner (camera or 2D USB scanner) recognises it and a phone
// camera opens the page.

const TOKEN = /^[A-Za-z0-9_-]{22}$/;

export function cardPath(token: string): string {
  return `/card/${token}`;
}

export function cardUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}${cardPath(token)}`;
}

// The card token in a scanned code, or null when the code is not a card (a
// product barcode, another site's QR).
export function cardTokenFromScan(code: string): string | null {
  const match = /(?:^|\/)card\/([A-Za-z0-9_-]+)\/?(?:[?#].*)?$/.exec(code.trim());
  const token = match?.[1] ?? null;
  return token && TOKEN.test(token) ? token : null;
}

// A WhatsApp link that opens a chat with the customer and the card link typed
// in; free, sent from the shop's phone.
export function whatsappCardLink(phoneE164: string, message: string): string {
  return `https://wa.me/${phoneE164.replace(/^\+/, "")}?text=${encodeURIComponent(message)}`;
}
