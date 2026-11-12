// Read a Splitwise group export (Group → Settings → Export as spreadsheet) and rebuild it here.
// Splitwise's file has one row per expense or payment and one column per person showing how
// that row changed their balance, then a "Total balance" row we use to check the import.

import { netBalances } from "./balances.ts";
import { guessCategory } from "./categories.ts";
import { parseCents } from "./money.ts";
import type { Category, Expense, Group, Settlement } from "./types.ts";

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const signedCents = (s: string): number | null => {
  const t = s.trim().replace(/[$,]/g, "");
  if (!t) return 0;
  const neg = t.startsWith("-") || /^\(.*\)$/.test(t);
  const c = parseCents(t.replace(/^-|[()]/g, ""));
  return c === null ? null : neg ? -c : c;
};

function toISODate(s: string): string | null {
  const t = s.trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return null;
}

export function mapCategory(splitwiseCategory: string, description: string): Category {
  const c = splitwiseCategory.toLowerCase();
  if (/grocer/.test(c)) return "Groceries";
  if (/dining|restaurant|food|liquor/.test(c)) return "Dining";
  if (/rent|mortgage/.test(c)) return "Rent";
  if (/electric|heat|gas\/|water|tv|phone|internet|utilit|trash/.test(c)) return "Utilities";
  if (/car|fuel|parking|taxi|bus|train|transport|bicycle/.test(c)) return "Transport";
  if (/household|furniture|maintenance|cleaning|appliance|pets|services/.test(c)) return "Household";
  if (/movie|game|music|sport|entertain/.test(c)) return "Entertainment";
  if (/hotel|plane|travel|lodging/.test(c)) return "Travel";
  return guessCategory(description);
}

export type ParsedRow = {
  date: string;
  description: string;
  category: string;
  costCents: number;
  currency: string;
  nets: number[]; // per person, same order as people
  isPayment: boolean;
};

export type ParsedSplitwise = {
  people: string[];
  rows: ParsedRow[];
  currency: string;
  otherCurrencies: string[];
  totals: number[] | null; // Splitwise's own "Total balance" row
  skipped: number; // rows that changed nobody's balance
  problems: string[];
};

export function parseSplitwise(text: string): ParsedSplitwise {
  const table = parseCsv(text).filter((r) => r.some((c) => c.trim()));
  const header = table[0]?.map((h) => h.trim()) ?? [];
  const lower = header.map((h) => h.toLowerCase());
  const col = (name: string) => lower.indexOf(name);
  const [iDate, iDesc, iCat, iCost, iCur] = ["date", "description", "category", "cost", "currency"].map(col);
  if ([iDate, iDesc, iCost, iCur].some((i) => i < 0)) {
    throw new Error("This doesn't look like a Splitwise export. It should start with Date, Description, Category, Cost, Currency.");
  }
  const firstPerson = Math.max(iDate, iDesc, iCat, iCost, iCur) + 1;
  const people = header.slice(firstPerson).filter(Boolean);
  if (people.length < 2) throw new Error("The file needs at least two people's columns.");

  const rows: ParsedRow[] = [];
  const problems: string[] = [];
  let totals: number[] | null = null;
  let skipped = 0;
  const currencyCount = new Map<string, number>();

  for (const [n, r] of table.slice(1).entries()) {
    const description = (r[iDesc] ?? "").trim();
    const nets = people.map((_, k) => signedCents(r[firstPerson + k] ?? ""));
    if (nets.some((v) => v === null)) {
      problems.push(`Row ${n + 2}: an amount isn't a number, so it was skipped.`);
      continue;
    }
    if (/^total balance$/i.test(description)) {
      totals = nets as number[];
      continue;
    }
    const date = toISODate(r[iDate] ?? "");
    const cost = signedCents(r[iCost] ?? "");
    if (!date || cost === null) {
      problems.push(`Row ${n + 2} ("${description}") has no valid date or cost, so it was skipped.`);
      continue;
    }
    if ((nets as number[]).every((v) => v === 0)) {
      skipped++;
      continue;
    }
    const sum = (nets as number[]).reduce((a, b) => a + b, 0);
    if (sum !== 0) problems.push(`Row ${n + 2} ("${description}") doesn't balance by ${(sum / 100).toFixed(2)}; imported as written.`);
    const currency = (r[iCur] ?? "").trim().toUpperCase() || "CAD";
    currencyCount.set(currency, (currencyCount.get(currency) ?? 0) + 1);
    const category = iCat >= 0 ? (r[iCat] ?? "").trim() : "";
    rows.push({
      date, description, category, costCents: Math.abs(cost), currency, nets: nets as number[],
      isPayment: /^payment$/i.test(category) || (/ paid /i.test(description) && (nets as number[]).filter((v) => v !== 0).length === 2),
    });
  }
  const currency = [...currencyCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "CAD";
  return { people, rows, currency, otherCurrencies: [...currencyCount.keys()].filter((c) => c !== currency), totals, skipped, problems };
}

/**
 * Rebuild expenses so every person's balance matches Splitwise exactly.
 * With one person ahead on a row, they paid the full cost. With several, each paid what they're ahead by.
 */
export function buildGroup(parsed: ParsedSplitwise, opts: { name: string; meIndex: number; rates: Record<string, number>; makeId: () => string }): Group {
  const members = parsed.people.map((name) => ({ id: opts.makeId(), name }));
  const expenses: Expense[] = [];
  const settlements: Settlement[] = [];
  parsed.rows.forEach((row, n) => {
    const rate = row.currency === parsed.currency ? 1 : opts.rates[row.currency];
    if (!rate) throw new Error(`Enter a rate for ${row.currency}`);
    const conv = (c: number) => Math.round(c * rate);
    // Convert nets so they still sum to zero after rounding.
    let nets = row.nets.map(conv);
    const drift = nets.reduce((a, b) => a + b, 0);
    if (drift !== 0) {
      const k = nets.findIndex((v) => v !== 0);
      nets = nets.map((v, i) => (i === k ? v - drift : v));
    }
    const ids = members.map((m) => m.id);
    const createdAt = n;
    if (row.isPayment) {
      const from = nets.findIndex((v) => v > 0);
      const to = nets.findIndex((v) => v < 0);
      if (from >= 0 && to >= 0 && nets.filter((v) => v !== 0).length === 2) {
        settlements.push({ id: opts.makeId(), from: ids[from], to: ids[to], cents: nets[from], date: row.date, createdAt });
        return;
      }
    }
    const ahead = nets.map((v, i) => [i, v] as const).filter(([, v]) => v > 0);
    const behind = nets.map((v, i) => [i, v] as const).filter(([, v]) => v < 0);
    let payers: Record<string, number>;
    let shares: Record<string, number>;
    let total: number;
    const cost = conv(row.costCents);
    if (ahead.length === 1 && cost >= ahead[0][1]) {
      const [p, lent] = ahead[0];
      total = cost;
      payers = { [ids[p]]: cost };
      shares = Object.fromEntries(behind.map(([i, v]) => [ids[i], -v]));
      if (cost - lent > 0) shares[ids[p]] = cost - lent; // the payer's own share
    } else {
      total = ahead.reduce((a, [, v]) => a + v, 0);
      payers = Object.fromEntries(ahead.map(([i, v]) => [ids[i], v]));
      shares = Object.fromEntries(behind.map(([i, v]) => [ids[i], -v]));
    }
    expenses.push({
      id: opts.makeId(), description: row.description || "Imported expense", date: row.date, payers, totalCents: total,
      split: { kind: "exact", shares }, category: mapCategory(row.category, row.description), createdAt,
      foreign: rate !== 1 ? { currency: row.currency, cents: row.costCents, rate } : undefined,
      notes: total !== cost ? `Imported from Splitwise. Original cost ${(cost / 100).toFixed(2)}; several people paid.` : undefined,
    });
  });
  return {
    id: opts.makeId(), name: opts.name, currency: parsed.currency, members, meId: members[opts.meIndex]?.id ?? members[0].id,
    expenses: expenses.reverse(), settlements: settlements.reverse(), recurring: [], createdAt: Date.now(),
  };
}

/** Compare our balances with Splitwise's "Total balance" row. Empty list = perfect match. */
export function checkAgainstSplitwise(group: Group, parsed: ParsedSplitwise): string[] {
  if (!parsed.totals || parsed.otherCurrencies.length) return [];
  const net = netBalances(group);
  return group.members
    .map((m, i) => ({ m, ours: net[m.id] ?? 0, theirs: parsed.totals![i] }))
    .filter((x) => x.ours !== x.theirs)
    .map((x) => `${x.m.name}: Splitwise says ${(x.theirs / 100).toFixed(2)}, we got ${(x.ours / 100).toFixed(2)}`);
}
