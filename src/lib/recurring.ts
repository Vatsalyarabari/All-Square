// Repeating expenses: on or after each due date, add a copy and move the due date forward.

import type { Expense, Group, Recurring } from "./types.ts";

export function nextDate(iso: string, every: Recurring["every"]): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (every === "week") {
    const t = new Date(Date.UTC(y, m - 1, d + 7));
    return t.toISOString().slice(0, 10);
  }
  // Same day next month; the 31st becomes the last day of a shorter month.
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const t = new Date(Date.UTC(y, m, Math.min(d, lastDay)));
  return t.toISOString().slice(0, 10);
}

/** Adds every copy that has come due by `today`. Returns the same group object if nothing was due. */
export function runRecurring(group: Group, today: string, makeId: () => string, now = Date.now()): Group {
  let changed = false;
  const added: Expense[] = [];
  const recurring = group.recurring.map((r) => {
    let due = r.nextDate;
    let guard = 0;
    while (due <= today && guard++ < 120) {
      added.push({ ...structuredClone(r.template), id: makeId(), date: due, recurringId: r.id, createdAt: now });
      due = nextDate(due, r.every);
      changed = true;
    }
    return due === r.nextDate ? r : { ...r, nextDate: due };
  });
  if (!changed) return group;
  return { ...group, recurring, expenses: [...added.reverse(), ...group.expenses] };
}
