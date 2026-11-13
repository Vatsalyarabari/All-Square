// Where the app keeps its data. Three modes, same screens and same money rules:
//   cloud: signed in, groups live in Supabase and update live on every phone
//   local: no server configured (e.g. the preview), saved in this browser only
//   demo:  the sample group, kept in memory and never saved anywhere
// Every change is applied on screen straight away, then (in cloud mode) saved and reloaded.

import { useSyncExternalStore } from "react";
import { guessCategory } from "./categories.ts";
import * as cloud from "./cloud.ts";
import { learn } from "./itemMemory.ts";
import { todayISO } from "./money.ts";
import { nextDate, runRecurring } from "./recurring.ts";
import type { Receipt } from "./split.ts";
import type { AppState, Expense, Group, OpenReceipt, Recurring, Settlement, Split } from "./types.ts";

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

const empty: AppState = { version: 2, groups: [] };

function loadLocal(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) ?? OLD_KEYS.map((k) => localStorage.getItem(k)).find(Boolean) ?? null;
    if (raw) {
      const migrated = migrate(JSON.parse(raw));
      if (migrated) return catchUp(migrated);
    }
  } catch {
    // storage blocked or corrupted: start empty rather than crash
  }
  return empty;
}

// ---------- State ----------

export type Mode = "cloud" | "local" | "demo";
export type Account = { userId: string; email?: string; isGuest: boolean; name?: string } | null;
export type Status = "loading" | "ready" | "signed-out";

type Store = { mode: Mode; status: Status; account: Account; data: AppState };

let store: Store = cloud.cloudEnabled
  ? { mode: "cloud", status: "loading", account: null, data: empty }
  : { mode: "local", status: "ready", account: null, data: loadLocal() };
let beforeDemo: Mode = store.mode;

const listeners = new Set<() => void>();
const errorListeners = new Set<(message: string) => void>();
const emit = () => listeners.forEach((l) => l());

function set(patch: Partial<Store>) {
  store = { ...store, ...patch };
  if (store.mode === "local" && patch.data) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store.data));
    } catch {
      // private mode or full storage (often a big photo): keep working in memory
    }
  }
  emit();
}

const subscribe = (l: () => void) => (listeners.add(l), () => listeners.delete(l));
export const useAppState = (): AppState => useSyncExternalStore(subscribe, () => store.data);
export const useStore = (): Store => useSyncExternalStore(subscribe, () => store);
export const getStore = () => store;

/** Screens show these as toasts (failed saves, lost connection, permission problems). */
export function onStoreError(fn: (message: string) => void) {
  errorListeners.add(fn);
  return () => errorListeners.delete(fn);
}
const report = (e: unknown) => {
  const message = e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : "Something went wrong";
  errorListeners.forEach((fn) => fn(message));
};

// ---------- Cloud session ----------

export async function reload() {
  if (store.mode !== "cloud" || !store.account) return;
  try {
    const groups = await cloud.loadGroups(store.account.userId);
    if (store.mode === "cloud") set({ data: { version: 2, groups }, status: "ready" });
  } catch (e) {
    report(e);
    if (store.mode === "cloud" && store.status === "loading") set({ status: "ready" }); // show the app (and the error) rather than a stuck splash
  }
}

let stopWatching = () => {};
export async function startCloud() {
  if (!cloud.cloudEnabled) return;
  const apply = async (session: Awaited<ReturnType<typeof cloud.getSession>>) => {
    if (!session) {
      stopWatching();
      if (store.mode === "cloud") set({ account: null, status: "signed-out", data: empty });
      return;
    }
    const u = session.user;
    const account = { userId: u.id, email: u.email ?? undefined, isGuest: Boolean(u.is_anonymous), name: (u.user_metadata?.full_name as string | undefined) ?? undefined };
    const changedUser = store.account?.userId !== u.id;
    set({ account });
    if (changedUser) {
      stopWatching();
      stopWatching = cloud.watchChanges(() => void reload());
      await reload();
      runCatchUp();
    }
  };
  cloud.onSessionChange((s) => void apply(s));
  await apply(await cloud.getSession());
}

function runCatchUp() {
  if (store.mode !== "cloud") return;
  cloud.catchUpRecurring(store.data.groups, todayISO()).then(reload, report);
}

// ---------- Groups saved on this phone before signing in ----------

/** The sample group older versions put on every phone; never worth moving to an account. */
export const isSampleGroup = (g: Group) => g.name === "Kingsway apartment" && g.expenses.some((e) => e.description === "Masala Boyz dinner");

/** In cloud mode: groups still sitting in this browser's storage from before accounts existed. */
export function phoneGroups(): Group[] {
  return store.mode === "cloud" ? loadLocal().groups : [];
}

export function forgetPhoneGroups() {
  try {
    [STORAGE_KEY, ...OLD_KEYS].forEach((k) => localStorage.removeItem(k));
  } catch {
    // storage blocked: nothing to forget
  }
  emit();
}

/** Copies the chosen phone groups into the signed-in account (you become their creator), then clears the phone copy. */
export async function moveFromPhone(ids: string[]) {
  const acct = store.account;
  if (store.mode !== "cloud" || !acct) return;
  for (const g of loadLocal().groups.filter((x) => ids.includes(x.id))) {
    await cloud.importGroup(g, acct.userId, acct.email);
  }
  forgetPhoneGroups();
  await reload();
}

// ---------- Demo ----------

export function enterDemo() {
  beforeDemo = store.mode === "demo" ? beforeDemo : store.mode;
  set({ mode: "demo", status: "ready", data: seedState() });
}

export function exitDemo() {
  if (beforeDemo === "local") set({ mode: "local", status: "ready", data: loadLocal() });
  else {
    set({ mode: "cloud", status: store.account ? "loading" : "signed-out", data: empty });
    void reload();
  }
}

// ---------- Changes ----------

const updateGroup = (groupId: string, change: (g: Group) => Group) =>
  set({ data: { ...store.data, groups: store.data.groups.map((g) => (g.id === groupId ? change(g) : g)) } });
const groupById = (id: string) => store.data.groups.find((g) => g.id === id);

/** Apply on screen now; in cloud mode also save, then reload what the database has. */
function change(local: () => void, remote?: () => Promise<unknown>) {
  local();
  if (store.mode === "cloud" && remote) remote().then(reload, (e) => {
    report(e);
    void reload();
  });
}

export type ExpenseInput = Omit<Expense, "id" | "createdAt"> & { id?: string; repeat?: Recurring["every"] | "never" };

export const actions = {
  catchUpRecurring: () => (store.mode === "cloud" ? runCatchUp() : store.mode === "local" ? set({ data: catchUp(store.data) }) : undefined),
  resetDemo: () => enterDemo(),

  createGroup(name: string, memberNames: string[], currency: string): string {
    const id = newId();
    const members = memberNames.map((n, i) => ({ id: newId(), name: n, userId: i === 0 ? store.account?.userId : undefined }));
    const group: Group = { id, name, currency, members, meId: members[0].id, expenses: [], settlements: [], recurring: [], createdByMe: true, createdAt: Date.now() };
    change(
      () => set({ data: { ...store.data, groups: [group, ...store.data.groups] } }),
      () => cloud.createGroup(id, name, memberNames, currency, store.account!.userId, store.account!.email),
    );
    return id;
  },

  deleteGroup: (groupId: string) =>
    change(() => set({ data: { ...store.data, groups: store.data.groups.filter((g) => g.id !== groupId) } }), () => cloud.deleteGroup(groupId)),

  leaveGroup: (groupId: string) => {
    const me = groupById(groupId)?.meId;
    change(() => set({ data: { ...store.data, groups: store.data.groups.filter((g) => g.id !== groupId) } }), () => cloud.leaveGroup(me!));
  },

  addMember: (groupId: string, name: string, email?: string, phone?: string) =>
    change(
      () => updateGroup(groupId, (g) => ({ ...g, members: [...g.members, { id: newId(), name, email, phone }] })),
      () => cloud.addMember(groupId, name, email, phone),
    ),

  updateMember: (groupId: string, memberId: string, patch: { name?: string; email?: string; phone?: string }) =>
    change(
      () => updateGroup(groupId, (g) => ({ ...g, members: g.members.map((m) => (m.id === memberId ? { ...m, ...patch } : m)) })),
      () => cloud.updateMember(memberId, { name: patch.name, email: patch.email === undefined ? undefined : patch.email || null, phone: patch.phone === undefined ? undefined : patch.phone || null }),
    ),

  setMe: (groupId: string, meId: string) => updateGroup(groupId, (g) => ({ ...g, meId })), // local and demo only

  setDefaultSplit: (groupId: string, split: Split | undefined) =>
    change(() => updateGroup(groupId, (g) => ({ ...g, defaultSplit: split })), () => cloud.setDefaultSplit(groupId, split)),

  saveExpense(groupId: string, input: ExpenseInput) {
    const { repeat, id, ...expense } = input;
    const recurringId = !id && repeat && repeat !== "never" ? newId() : expense.recurringId;
    change(
      () => updateGroup(groupId, (g) => {
        if (id) return { ...g, expenses: g.expenses.map((e) => (e.id === id ? { ...e, ...expense, id } : e)) };
        let recurring = g.recurring;
        if (repeat && repeat !== "never") {
          const { date, recurringId: _r, ...template } = expense as Expense;
          void _r;
          recurring = [...recurring, { id: recurringId!, every: repeat, nextDate: nextDate(date, repeat), template }];
        }
        return { ...g, recurring, expenses: [{ ...expense, id: newId(), createdAt: Date.now(), recurringId }, ...g.expenses] };
      }),
      () => cloud.saveExpense(groupId, id, expense, repeat, newId),
    );
  },

  rememberItems: (groupId: string, lines: { name: string; who: string[] }[]) => {
    const g = groupById(groupId);
    change(() => updateGroup(groupId, (x) => ({ ...x, itemMemory: learn(x.itemMemory, lines) })), () => cloud.rememberItems(g!, lines));
  },

  importGroup: (group: Group) => {
    const g = { ...group, members: group.members.map((m) => (m.id === group.meId ? { ...m, userId: store.account?.userId } : m)), createdByMe: true };
    change(() => set({ data: { ...store.data, groups: [g, ...store.data.groups] } }), () => cloud.importGroup(group, store.account!.userId, store.account!.email));
  },

  deleteExpense: (groupId: string, expenseId: string) =>
    change(() => updateGroup(groupId, (g) => ({ ...g, expenses: g.expenses.filter((e) => e.id !== expenseId) })), () => cloud.deleteExpense(expenseId)),

  stopRecurring: (groupId: string, recurringId: string) =>
    change(() => updateGroup(groupId, (g) => ({ ...g, recurring: g.recurring.filter((r) => r.id !== recurringId) })), () => cloud.stopRecurring(recurringId)),

  addSettlement: (groupId: string, s: Omit<Settlement, "id" | "createdAt">) =>
    change(
      () => updateGroup(groupId, (g) => ({ ...g, settlements: [{ ...s, id: newId(), createdAt: Date.now() }, ...g.settlements] })),
      () => cloud.addSettlement(groupId, s),
    ),

  deleteSettlement: (groupId: string, id: string) =>
    change(() => updateGroup(groupId, (g) => ({ ...g, settlements: g.settlements.filter((s) => s.id !== id) })), () => cloud.deleteSettlement(id)),

  // ----- Shared receipts (cloud only) -----

  async shareReceipt(groupId: string, receipt: Receipt, date: string, payerId: string): Promise<string> {
    const id = await cloud.shareReceipt(groupId, receipt, date, payerId, newId);
    await reload();
    return id;
  },

  toggleClaim(groupId: string, receiptId: string, unitId: string, memberId: string) {
    const r = groupById(groupId)?.receipts?.find((x) => x.id === receiptId);
    const on = !r?.claims.some((c) => c.unitId === unitId && c.memberId === memberId);
    change(
      () => updateGroup(groupId, (g) => ({
        ...g,
        receipts: g.receipts?.map((x) => x.id !== receiptId ? x : {
          ...x, claims: on ? [...x.claims, { unitId, memberId }] : x.claims.filter((c) => !(c.unitId === unitId && c.memberId === memberId)),
        }),
      })),
      () => cloud.setClaim(receiptId, unitId, memberId, on),
    );
  },

  updateReceipt(groupId: string, r: OpenReceipt, patch: Partial<Pick<OpenReceipt, "payerId" | "tipCents">>) {
    change(() => updateGroup(groupId, (g) => ({ ...g, receipts: g.receipts?.map((x) => (x.id === r.id ? { ...x, ...patch } : x)) })), () => cloud.updateReceipt(r, patch));
  },

  async finishReceipt(groupId: string, receiptId: string, expense: ExpenseInput, lines: { name: string; who: string[] }[]) {
    const g = groupById(groupId)!;
    const { repeat: _r, id: _i, ...data } = expense;
    void _r; void _i;
    const expenseId = await cloud.saveExpense(groupId, undefined, data, "never", newId);
    await cloud.closeReceipt(receiptId, "done", expenseId);
    await cloud.rememberItems(g, lines);
    await reload();
  },

  cancelReceipt: (groupId: string, receiptId: string) =>
    change(() => updateGroup(groupId, (g) => ({ ...g, receipts: g.receipts?.filter((x) => x.id !== receiptId) })), () => cloud.closeReceipt(receiptId, "cancelled")),
};
