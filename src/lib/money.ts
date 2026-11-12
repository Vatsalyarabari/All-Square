// Turning typed amounts into cents and back. Floats are never stored.

/** "12.5" -> 1250, "$1,234.99" -> 123499. Returns null for anything that isn't a valid amount. */
export function parseCents(input: string): number | null {
  const text = input.trim().replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{0,2})?$/.test(text) && !/^\.\d{1,2}$/.test(text)) return null;
  const [dollars, fraction = ""] = text.split(".");
  return Number(dollars || "0") * 100 + Number((fraction + "00").slice(0, 2));
}

/** "33.33" -> 3333 hundredths of a percent. */
export const parsePercent = (input: string) => parseCents(input.replace("%", ""));

const formatters = new Map<string, Intl.NumberFormat>();
export function formatCents(cents: number, currency = "CAD"): string {
  if (!formatters.has(currency)) {
    formatters.set(currency, new Intl.NumberFormat("en-CA", { style: "currency", currency, currencyDisplay: "narrowSymbol" }));
  }
  return formatters.get(currency)!.format(cents / 100);
}

export const centsToInput = (cents: number) => (cents / 100).toFixed(2);

export function todayISO(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

/** Number-pad typing rules from the spec: max 2 decimals, max 7 digits, a leading 0 is replaced. */
export function padInput(current: string, key: string): string {
  if (key === "⌫") return current.slice(0, -1);
  if (key === ".") return current.includes(".") ? current : (current || "0") + ".";
  const [whole, frac] = current.split(".");
  if (frac !== undefined && frac.length >= 2) return current;
  if (frac === undefined && whole === "0") return key;
  if (current.replace(".", "").length >= 7) return current;
  return current + key;
}

export const CURRENCIES = ["CAD", "USD", "EUR", "GBP", "INR", "MXN", "JPY", "AUD"];
