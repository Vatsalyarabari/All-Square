// Turning a group into a spreadsheet file and plain-text messages.

import { expenseShares, summary } from "./balances.ts";
import { formatCents } from "./money.ts";
import type { Group } from "./types.ts";

const cell = (v: string | number) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const dollars = (c: number) => (c / 100).toFixed(2);

/** One row per expense or payment, one column per person (their net effect), like Splitwise's export. */
export function groupToCsv(group: Group): string {
  const names = group.members.map((m) => m.name);
  const header = ["Date", "Description", "Category", "Cost", "Currency", "Original", ...names];
  const rows: (string | number)[][] = [];
  const items = [
    ...group.expenses.map((e) => ({ date: e.date, at: e.createdAt, e, s: undefined })),
    ...group.settlements.map((s) => ({ date: s.date, at: s.createdAt, e: undefined, s })),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.at - b.at);

  for (const it of items) {
    if (it.e) {
      const shares = expenseShares(it.e);
      const original = it.e.foreign ? `${dollars(it.e.foreign.cents)} ${it.e.foreign.currency} @ ${it.e.foreign.rate}` : "";
      rows.push([
        it.e.date, it.e.description, it.e.category, dollars(it.e.totalCents), group.currency, original,
        ...group.members.map((m) => dollars((it.e!.payers[m.id] ?? 0) - (shares[m.id] ?? 0))),
      ]);
    } else if (it.s) {
      const from = group.members.find((m) => m.id === it.s!.from)?.name ?? "";
      const to = group.members.find((m) => m.id === it.s!.to)?.name ?? "";
      rows.push([
        it.s.date, `${from} paid ${to}`, "Payment", dollars(it.s.cents), group.currency, "",
        ...group.members.map((m) => dollars(m.id === it.s!.from ? it.s!.cents : m.id === it.s!.to ? -it.s!.cents : 0)),
      ]);
    }
  }
  const totals = summary(group);
  rows.push(["", "Total balance", "", "", group.currency, "", ...totals.map((t) => dollars(t.net))]);
  return [header, ...rows].map((r) => r.map(cell).join(",")).join("\n") + "\n";
}

export function payMessage(group: Group, toName: string, cents: number): string {
  return `Hi ${toName}, sending you ${formatCents(cents, group.currency)} for ${group.name} (from Allsquare).`;
}

export function reminderMessage(group: Group, fromName: string, cents: number, myName: string): string {
  return `Hi ${fromName}! Quick reminder from Allsquare: you owe ${myName} ${formatCents(cents, group.currency)} for ${group.name}. e-Transfer whenever you get a chance. Thanks!`;
}
