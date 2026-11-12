// Where the app keeps its data. For now: this browser only (localStorage).
// Later this is the only file that changes when we move to an online database.

import { useSyncExternalStore } from "react";
import { guessCategory } from "./categories.ts";
import { learn } from "./itemMemory.ts";
import { todayISO } from "./money.ts";
import { nextDate, runRecurring } from "./recurring.ts";
import type { AppState, Expense, Group, Recurring, Settlement, Split } from "./types.ts";

const STORAGE_KEY = "allsquare:v1";
const OLD_KEYS = ["splitfree:v1"]; // data saved before the rename is picked up once

export function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

/** The demo group from the design spec. */
export function seedState(): AppState {
  const [v, r, p] = ["Vatsalya", "Rahul", "Priya"].map((name) => ({ id: newId(), name }));
  const today = todayISO();
  const expenses: Expense[] = [
    {
      id: newId(), description: "Masala Boyz dinner", date: today, payers: { [r.id]: 6000 }, totalCents: 6000,
      split: { kind: "exact", shares: { [v.id]: 2500, [r.id]: 2000, [p.id]: 1500 } }, category: "Dining", createdAt: 2,
    },
    {
      id: newId(), description: "Costco run", date: today, payers: { [v.id]: 13458 }, totalCents: 13458,
      split: { kind: "equal", among: [v.id, r.id, p.id] }, category: "Groceries", createdAt: 1,
    },
  ];
  return {
    version: 2,
    groups: [{
      id: newId(), name: "Kingsway apartment", currency: "CAD", members: [v, r, p], meId: v.id,
      expenses, settlements: [], recurring: [], createdAt: 0,
    }],
  };
}

/** Upgrade data saved by Stage 1 (one payer, no categories) to the current shape. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function migrate(raw: any): AppState | null {
  if (raw?.version === 2 && Array.isArray(raw.groups)) return raw;
  if (raw?.version !== 1 || !Array.isArray(raw.groups)) return null;
  return {
    version: 2,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    groups: raw.groups.map((g: any) => ({
      ...g,
      currency: "CAD",
      meId: g.members[0]?.id ?? "",
      recurring: [],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expenses: g.expenses.map(({ paidBy, ...e }: any) => ({
        ...e, payers: { [paidBy]: e.totalCents }, category: guessCategory(e.description),
      })),
    })),
  };
}

function catchUp(s: AppState): AppState {
  const today = todayISO();
  const groups = s.groups.map((g) => runRecurring(g, today, newId));
  return groups.every((g, i) => g === s.groups[i]) ? s : { ...s, groups };
}

function load(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) ?? OLD_KEYS.map((k) => localStorage.getItem(k)).find(Boolean) ?? null;
    if (raw) {
      const migrated = migrate(JSON.parse(raw));
      if (migrated) return catchUp(migrated);
    }
  } catch {
    // storage blocked or corrupted: start with the demo rather than crash
  }
  return seedState();
}

let state: AppState = load();
const listeners = new Set<() => void>();

function commit(next: AppState) {
  state = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // private mode or full storage (often a big photo): keep working in memory
  }
  listeners.forEach((l) => l());
}

export function useAppState(): AppState {
  return useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => state);
}

const updateGroup = (groupId: string, change: (g: Group) => Group) =>
  commit({ ...state, groups: state.groups.map((g) => (g.id === groupId ? change(g) : g)) });

export type ExpenseInput = Omit<Expense, "id" | "createdAt"> & { id?: string; repeat?: Recurring["every"] | "never" };

export const actions = {
  catchUpRecurring: () => commit(catchUp(state)),
  resetDemo: () => commit(seedState()),

  createGroup(name: string, memberNames: string[], currency: string): string {
    const members = memberNames.map((n) => ({ id: newId(), name: n }));
    const group: Group = {
      id: newId(), name, currency, members, meId: members[0].id,
      expenses: [], settlements: [], recurring: [], createdAt: Date.now(),
    };
    commit({ ...state, groups: [group, ...state.groups] });
    return group.id;
  },

  deleteGroup: (groupId: string) => commit({ ...state, groups: state.groups.filter((g) => g.id !== groupId) }),

  addMember: (groupId: string, name: string) =>
    updateGroup(groupId, (g) => ({ ...g, members: [...g.members, { id: newId(), name }] })),

  setMe: (groupId: string, meId: string) => updateGroup(groupId, (g) => ({ ...g, meId })),

  setDefaultSplit: (groupId: string, split: Split | undefined) => updateGroup(groupId, (g) => ({ ...g, defaultSplit: split })),

  saveExpense(groupId: string, input: ExpenseInput) {
    const { repeat, ...expense } = input;
    updateGroup(groupId, (g) => {
      if (expense.id) {
        return { ...g, expenses: g.expenses.map((e) => (e.id === expense.id ? { ...e, ...expense, id: e.id } : e)) };
      }
      let recurring = g.recurring;
      let recurringId: string | undefined;
      if (repeat && repeat !== "never") {
        recurringId = newId();
        const { date, recurringId: _r, ...template } = expense as Expense;
        void _r;
        recurring = [...recurring, { id: recurringId, every: repeat, nextDate: nextDate(date, repeat), template }];
      }
      return { ...g, recurring, expenses: [{ ...expense, id: newId(), createdAt: Date.now(), recurringId }, ...g.expenses] };
    });
  },

  rememberItems: (groupId: string, lines: { name: string; who: string[] }[]) =>
    updateGroup(groupId, (g) => ({ ...g, itemMemory: learn(g.itemMemory, lines) })),

  importGroup: (group: Group) => commit({ ...state, groups: [group, ...state.groups] }),

  deleteExpense: (groupId: string, expenseId: string) =>
    updateGroup(groupId, (g) => ({ ...g, expenses: g.expenses.filter((e) => e.id !== expenseId) })),

  stopRecurring: (groupId: string, recurringId: string) =>
    updateGroup(groupId, (g) => ({ ...g, recurring: g.recurring.filter((r) => r.id !== recurringId) })),

  addSettlement: (groupId: string, s: Omit<Settlement, "id" | "createdAt">) =>
    updateGroup(groupId, (g) => ({ ...g, settlements: [{ ...s, id: newId(), createdAt: Date.now() }, ...g.settlements] })),

  deleteSettlement: (groupId: string, id: string) =>
    updateGroup(groupId, (g) => ({ ...g, settlements: g.settlements.filter((s) => s.id !== id) })),
};
