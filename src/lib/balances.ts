// Who owes whom. Positive balance = the group owes you; negative = you owe the group.

import { allocate } from "./split.ts";
import type { Expense, Group, Split } from "./types.ts";

/** Each person's share of an amount under a split. Always adds up to the amount exactly. */
export function sharesFor(split: Split, totalCents: number): Record<string, number> {
  const byWeight = (weights: Record<string, number>) => {
    const ids = Object.keys(weights).filter((id) => weights[id] > 0);
    if (ids.length === 0) throw new Error("Pick at least one person");
    const parts = allocate(totalCents, ids.map((id) => weights[id]));
    return Object.fromEntries(ids.map((id, i) => [id, parts[i]]));
  };
  switch (split.kind) {
    case "equal":
      return byWeight(Object.fromEntries(split.among.map((id) => [id, 1])));
    case "shares":
      return byWeight(split.weights);
    case "percent": {
      const sum = Object.values(split.percents).reduce((a, b) => a + b, 0);
      if (sum !== 10000) throw new Error(`Percentages add to ${sum / 100}%, not 100%`);
      return byWeight(split.percents);
    }
    case "exact": {
      const sum = Object.values(split.shares).reduce((a, b) => a + b, 0);
      if (sum !== totalCents) throw new Error(`Amounts add to ${sum}, expense is ${totalCents}`);
      return Object.fromEntries(Object.entries(split.shares).filter(([, c]) => c !== 0));
    }
  }
}

export const expenseShares = (e: Expense) => sharesFor(e.split, e.totalCents);

/** Net position of every member after all expenses and settlements. Sums to zero. */
export function netBalances(group: Group): Record<string, number> {
  const net: Record<string, number> = Object.fromEntries(group.members.map((m) => [m.id, 0]));
  const add = (id: string, cents: number) => (net[id] = (net[id] ?? 0) + cents);
  for (const e of group.expenses) {
    for (const [id, paid] of Object.entries(e.payers)) add(id, paid); // money they put in
    for (const [id, share] of Object.entries(expenseShares(e))) add(id, -share); // what they used
  }
  for (const s of group.settlements) {
    add(s.from, s.cents);
    add(s.to, -s.cents);
  }
  return net;
}

export type Transfer = { from: string; to: string; cents: number };

/** The fewest simple payments that clear everyone: pair the biggest debtor with the biggest creditor, repeat. */
export function simplifyDebts(net: Record<string, number>): Transfer[] {
  const order = (a: { id: string; cents: number }, b: { id: string; cents: number }) => b.cents - a.cents || a.id.localeCompare(b.id);
  const owes = Object.entries(net).filter(([, c]) => c < 0).map(([id, c]) => ({ id, cents: -c })).sort(order);
  const owed = Object.entries(net).filter(([, c]) => c > 0).map(([id, c]) => ({ id, cents: c })).sort(order);
  const out: Transfer[] = [];
  let i = 0, j = 0;
  while (i < owes.length && j < owed.length) {
    const cents = Math.min(owes[i].cents, owed[j].cents);
    out.push({ from: owes[i].id, to: owed[j].id, cents });
    owes[i].cents -= cents;
    owed[j].cents -= cents;
    if (owes[i].cents === 0) i++;
    if (owed[j].cents === 0) j++;
  }
  return out;
}

/** How one expense touches one person: what they lent (positive) or borrowed (negative). */
export function involvement(e: Expense, memberId: string): { kind: "lent" | "owe" | "none"; cents: number } {
  const net = (e.payers[memberId] ?? 0) - (expenseShares(e)[memberId] ?? 0);
  if (!(memberId in e.payers) && !(memberId in expenseShares(e))) return { kind: "none", cents: 0 };
  return net >= 0 ? { kind: "lent", cents: net } : { kind: "owe", cents: -net };
}

/** Per-person totals for a summary: paid, used, net. */
export function summary(group: Group) {
  const rows = Object.fromEntries(group.members.map((m) => [m.id, { paid: 0, share: 0 }]));
  for (const e of group.expenses) {
    for (const [id, c] of Object.entries(e.payers)) rows[id] && (rows[id].paid += c);
    for (const [id, c] of Object.entries(expenseShares(e))) rows[id] && (rows[id].share += c);
  }
  const net = netBalances(group);
  return group.members.map((m) => ({ member: m, ...rows[m.id], net: net[m.id] ?? 0 }));
}

export const groupTotalSpent = (g: Group) => g.expenses.reduce((a, e) => a + e.totalCents, 0);

/** Convert a foreign amount to group-currency cents at the given rate. */
export const convert = (cents: number, rate: number) => Math.round(cents * rate);
