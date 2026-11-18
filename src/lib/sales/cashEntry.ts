import type { WeightKey } from "@/src/lib/sales/weightEntry";

// Text entry for the cash keypad: the amount a customer hands over. Like the
// weight pad it keeps the raw string and parses once, so typing "12." is not
// swallowed. Two decimals (centimes), and five integer digits: far more than
// any basket, and it stops a held key from filling the screen.
const MAX_INTEGER_DIGITS = 5;
const MAX_DECIMALS = 2;

export function pressCashKey(entry: string, key: WeightKey): string {
  if (key === "back") return entry.slice(0, -1);

  if (key === ".") {
    if (entry.includes(".")) return entry;
    return entry === "" ? "0." : `${entry}.`;
  }

  if (entry.includes(".")) {
    return entry.split(".")[1].length >= MAX_DECIMALS ? entry : entry + key;
  }
  if (entry === "0") return key === "0" ? entry : key;
  return entry.length >= MAX_INTEGER_DIGITS ? entry : entry + key;
}

// The customers a Pay Later search shows: names containing the text, those
// starting with it first. An empty search shows everyone.
export function filterCustomers<T extends { name: string }>(customers: T[], search: string): T[] {
  const term = search.trim().toLowerCase();
  if (!term) return customers;
  const starts: T[] = [];
  const contains: T[] = [];
  for (const customer of customers) {
    const name = customer.name.toLowerCase();
    if (name.startsWith(term)) starts.push(customer);
    else if (name.includes(term)) contains.push(customer);
  }
  return [...starts, ...contains];
}

// A name typed for a new customer that already exists (ignoring case and
// spaces): the cashier is pointed at the existing one instead of creating a
// duplicate that would split someone's debt in two.
export function findCustomerByName<T extends { name: string }>(
  customers: T[],
  name: string
): T | null {
  const wanted = name.trim().replace(/\s+/g, " ").toLowerCase();
  if (!wanted) return null;
  return customers.find((c) => c.name.trim().replace(/\s+/g, " ").toLowerCase() === wanted) ?? null;
}
