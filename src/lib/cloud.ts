// Talks to Supabase: sign-in, loading your groups, saving changes, and live updates.
// Turned on when VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY are set at build time.
// The database itself decides who may see what (see supabase/migrations/001_shared_groups.sql).

import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { learn } from "./itemMemory.ts";
import { nextDate } from "./recurring.ts";
import type { Receipt } from "./split.ts";
import type { Expense, Group, OpenReceipt, Recurring, Settlement, Split } from "./types.ts";

const URL = import.meta.env?.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export const cloudEnabled = Boolean(URL && KEY);
export const sb: SupabaseClient | null = cloudEnabled
  ? createClient(URL!, KEY!, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce" } })
  : null;

const db = () => {
  if (!sb) throw new Error("Sharing isn't set up in this build.");
  return sb;
};

/** The app's address without query or hash, used for sign-in returns and links in messages. */
export const appUrl = () => `${window.location.origin}${window.location.pathname}`;

// ---------- Sign-in ----------

export async function getSession(): Promise<Session | null> {
  if (!sb) return null;
  return (await sb.auth.getSession()).data.session;
}

export function onSessionChange(fn: (s: Session | null) => void) {
  if (!sb) return () => {};
  // Supabase holds a lock while this callback runs; calling it again inside would deadlock, so run afterwards.
  const { data } = sb.auth.onAuthStateChange((_event, session) => void setTimeout(() => fn(session), 0));
  return () => data.subscription.unsubscribe();
}

/** Come back to the same screen (e.g. an invite link) after signing in. */
const returnTo = () => window.location.href.split("#")[0];

export async function signInWithGoogle() {
  const { error } = await db().auth.signInWithOAuth({ provider: "google", options: { redirectTo: returnTo() } });
  if (error) throw error;
}

/** Sends an email with a sign-in link and a 6-digit code (the code works inside the home-screen app too). */
export async function sendEmailLink(email: string) {
  const { error } = await db().auth.signInWithOtp({ email, options: { emailRedirectTo: returnTo(), shouldCreateUser: true } });
  if (error) throw error;
}

export async function verifyEmailCode(email: string, code: string) {
  const { error } = await db().auth.verifyOtp({ email, token: code.trim(), type: "email" });
  if (error) throw error;
}

/** For friends opening an invite link: join without making an account. */
export async function signInAsGuest() {
  const { error } = await db().auth.signInAnonymously();
  if (error) throw error;
}

/** A guest keeps their groups by adding an email: Supabase sends a confirm link, then they can sign in anywhere. */
export async function upgradeGuest(email: string) {
  const { error } = await db().auth.updateUser({ email }, { emailRedirectTo: appUrl() });
  if (error) throw error;
}

export async function signOut() {
  await db().auth.signOut();
}

// ---------- Loading ----------

type MemberRow = { id: string; name: string; user_id: string | null; email: string | null; phone: string | null; created_at: string };
type DataRow = { id: string; data: Record<string, unknown>; created_at: string };
type ReceiptRow = { id: string; data: { receipt: Receipt; date: string; payerId: string; tipCents: number }; status: string; created_by: string | null; created_at: string; claims: { unit_id: string; member_id: string }[] };
type GroupRow = {
  id: string; name: string; currency: string; default_split: Split | null; item_memory: Record<string, string[]> | null;
  invite_code: string; created_by: string; created_at: string;
  members: MemberRow[]; expenses: DataRow[]; settlements: DataRow[]; recurring: DataRow[]; receipts: ReceiptRow[];
};

const time = (iso: string) => Date.parse(iso);

export function rowToGroup(r: GroupRow, uid: string): Group {
  const members = [...r.members].sort((a, b) => a.created_at.localeCompare(b.created_at)).map((m) => ({
    id: m.id, name: m.name, userId: m.user_id ?? undefined, email: m.email ?? undefined, phone: m.phone ?? undefined,
  }));
  const me = members.find((m) => m.userId === uid);
  return {
    id: r.id,
    name: r.name,
    currency: r.currency,
    members,
    meId: me?.id ?? members[0]?.id ?? "",
    defaultSplit: r.default_split ?? undefined,
    itemMemory: r.item_memory ?? {},
    inviteCode: r.invite_code,
    createdByMe: r.created_by === uid,
    expenses: r.expenses.map((e) => ({ ...(e.data as Omit<Expense, "id" | "createdAt">), id: e.id, createdAt: time(e.created_at) })),
    settlements: r.settlements.map((s) => ({ ...(s.data as Omit<Settlement, "id" | "createdAt">), id: s.id, createdAt: time(s.created_at) })),
    recurring: r.recurring.map((x) => ({ ...(x.data as Omit<Recurring, "id">), id: x.id })),
    receipts: r.receipts
      .filter((x) => x.status === "open")
      .map((x) => ({ id: x.id, ...x.data, createdBy: x.created_by ?? undefined, claims: x.claims.map((c) => ({ unitId: c.unit_id, memberId: c.member_id })) })),
    createdAt: time(r.created_at),
  };
}

export async function loadGroups(uid: string): Promise<Group[]> {
  const { data, error } = await db()
    .from("groups")
    .select("*, members(*), expenses(id,data,created_at), settlements(id,data,created_at), recurring(id,data,created_at), receipts(id,data,status,created_by,created_at,claims(unit_id,member_id))")
    .order("created_at", { ascending: false });
  if (error) throw error;
  // Only groups this person is actually in (a creator who left still owns the row but isn't in it).
  return (data as GroupRow[]).map((r) => rowToGroup(r, uid)).filter((g) => g.members.some((m) => m.userId === uid));
}

/** Calls `fn` (debounced) whenever anything in your groups changes on any phone. */
export function watchChanges(fn: () => void): () => void {
  if (!sb) return () => {};
  let t: number | undefined;
  const ping = () => {
    clearTimeout(t);
    t = window.setTimeout(fn, 250);
  };
  const channel = sb.channel("allsquare-changes");
  for (const table of ["groups", "members", "expenses", "settlements", "recurring", "receipts", "claims"]) {
    channel.on("postgres_changes", { event: "*", schema: "public", table }, ping);
  }
  channel.subscribe();
  return () => {
    clearTimeout(t);
    sb.removeChannel(channel);
  };
}

// ---------- Saving ----------

const check = <T extends { error: unknown }>(res: T) => {
  if (res.error) throw res.error;
  return res;
};
const strip = <T extends { id?: string; createdAt?: number }>(x: T) => {
  const { id: _i, createdAt: _c, ...rest } = x;
  void _i; void _c;
  return rest;
};

export async function createGroup(id: string, name: string, memberNames: string[], currency: string, uid: string, email?: string) {
  check(await db().from("groups").insert({ id, name, currency }));
  const rows = memberNames.map((n, i) => ({ group_id: id, name: n, user_id: i === 0 ? uid : null, email: i === 0 ? email ?? null : null }));
  check(await db().from("members").insert(rows));
}

export async function importGroup(g: Group, uid: string, email?: string) {
  check(await db().from("groups").insert({ id: g.id, name: g.name, currency: g.currency }));
  check(await db().from("members").insert(g.members.map((m) => ({
    id: m.id, group_id: g.id, name: m.name, user_id: m.id === g.meId ? uid : null, email: m.id === g.meId ? email ?? null : null,
  }))));
  if (g.expenses.length) check(await db().from("expenses").insert(g.expenses.map((e) => ({ id: e.id, group_id: g.id, data: strip(e) }))));
  if (g.settlements.length) check(await db().from("settlements").insert(g.settlements.map((s) => ({ id: s.id, group_id: g.id, data: strip(s) }))));
  if (g.recurring?.length) check(await db().from("recurring").insert(g.recurring.map(({ id, ...r }) => ({ id, group_id: g.id, data: r }))));
}

export const deleteGroup = async (gid: string) => void check(await db().from("groups").delete().eq("id", gid));
export const leaveGroup = async (memberId: string) => void check(await db().from("members").update({ user_id: null }).eq("id", memberId));

export const addMember = async (gid: string, name: string, email?: string, phone?: string) =>
  void check(await db().from("members").insert({ group_id: gid, name, email: email || null, phone: phone || null }));

export const updateMember = async (memberId: string, patch: { name?: string; email?: string | null; phone?: string | null }) =>
  void check(await db().from("members").update(patch).eq("id", memberId));

export const setDefaultSplit = async (gid: string, split: Split | undefined) =>
  void check(await db().from("groups").update({ default_split: split ?? null }).eq("id", gid));

export async function rememberItems(g: Group, lines: { name: string; who: string[] }[]) {
  check(await db().from("groups").update({ item_memory: learn(g.itemMemory, lines) }).eq("id", g.id));
}

export async function saveExpense(gid: string, id: string | undefined, expense: Omit<Expense, "id" | "createdAt">, repeat: Recurring["every"] | "never" | undefined, makeId: () => string) {
  if (id) {
    check(await db().from("expenses").update({ data: expense }).eq("id", id));
    return id;
  }
  const newId = makeId();
  let recurringId: string | undefined;
  if (repeat && repeat !== "never") {
    recurringId = makeId();
    const { date, recurringId: _r, ...template } = expense as Expense;
    void _r;
    check(await db().from("recurring").insert({ id: recurringId, group_id: gid, data: { every: repeat, nextDate: nextDate(date, repeat), template } }));
  }
  check(await db().from("expenses").insert({
    id: newId, group_id: gid, data: { ...expense, recurringId }, recurring_id: recurringId ?? null, occurs_on: recurringId ? expense.date : null,
  }));
  return newId;
}

export const deleteExpense = async (id: string) => void check(await db().from("expenses").delete().eq("id", id));
export const stopRecurring = async (id: string) => void check(await db().from("recurring").delete().eq("id", id));

export const addSettlement = async (gid: string, s: Omit<Settlement, "id" | "createdAt">) =>
  void check(await db().from("settlements").insert({ group_id: gid, data: s }));
export const deleteSettlement = async (id: string) => void check(await db().from("settlements").delete().eq("id", id));

/** Adds any repeating expenses that came due. Safe to run on many phones at once (the database refuses duplicates). */
export async function catchUpRecurring(groups: Group[], today: string) {
  for (const g of groups) {
    for (const r of g.recurring) {
      const rows = [];
      let due = r.nextDate;
      for (let guard = 0; due <= today && guard < 120; guard++) {
        rows.push({ group_id: g.id, data: { ...r.template, date: due, recurringId: r.id }, recurring_id: r.id, occurs_on: due });
        due = nextDate(due, r.every);
      }
      if (!rows.length) continue;
      check(await db().from("expenses").upsert(rows, { onConflict: "recurring_id,occurs_on", ignoreDuplicates: true }));
      check(await db().from("recurring").update({ data: { every: r.every, nextDate: due, template: r.template } }).eq("id", r.id));
    }
  }
}

// ---------- Invites ----------

export type InvitePreview = { group_id: string; name: string; already_member: boolean; members: { id: string; name: string; taken: boolean }[] };

export async function invitePreview(code: string): Promise<InvitePreview | null> {
  const { data, error } = await db().rpc("invite_preview", { code });
  if (error) throw error;
  return (data as InvitePreview | null) ?? null;
}

export async function joinGroup(code: string, memberId: string | null, newName: string | null): Promise<string> {
  const { data, error } = await db().rpc("join_group", { code, member: memberId, new_name: newName });
  if (error) throw error;
  return data as string;
}

export async function resetInvite(gid: string): Promise<string> {
  const { data, error } = await db().rpc("reset_invite", { gid });
  if (error) throw error;
  return data as string;
}

export const inviteLink = (code: string) => `${appUrl()}?join=${code}`;
export const receiptLink = (g: Group, receiptId: string) => `${appUrl()}?join=${g.inviteCode}&receipt=${receiptId}`;

// ---------- Shared receipts ----------

export async function shareReceipt(gid: string, receipt: Receipt, date: string, payerId: string, makeId: () => string): Promise<string> {
  const id = makeId();
  check(await db().from("receipts").insert({ id, group_id: gid, data: { receipt, date, payerId, tipCents: 0 } }));
  return id;
}

export async function setClaim(receiptId: string, unitId: string, memberId: string, on: boolean) {
  if (on) {
    check(await db().from("claims").upsert({ receipt_id: receiptId, unit_id: unitId, member_id: memberId }, { ignoreDuplicates: true }));
  } else {
    check(await db().from("claims").delete().match({ receipt_id: receiptId, unit_id: unitId, member_id: memberId }));
  }
}

export async function updateReceipt(r: OpenReceipt, patch: Partial<Pick<OpenReceipt, "payerId" | "tipCents">>) {
  check(await db().from("receipts").update({ data: { receipt: r.receipt, date: r.date, payerId: patch.payerId ?? r.payerId, tipCents: patch.tipCents ?? r.tipCents } }).eq("id", r.id));
}

export async function closeReceipt(receiptId: string, status: "done" | "cancelled", expenseId?: string) {
  check(await db().from("receipts").update({ status, expense_id: expenseId ?? null }).eq("id", receiptId));
}

// ---------- Emails sent by the app (supabase/functions/notify) ----------

export type NotifyKind = "invite" | "receipt" | "reminder";

export async function sendEmail(kind: NotifyKind, groupId: string, memberId: string, extra: { receiptId?: string; amountCents?: number } = {}) {
  const { data, error } = await db().functions.invoke("notify", { body: { kind, groupId, memberId, appUrl: appUrl(), ...extra } });
  if (error) {
    // The function answers with { error } and a status; surface its words when we have them.
    const ctx = (error as { context?: Response }).context;
    const body = ctx && typeof ctx.json === "function" ? await ctx.json().catch(() => null) : null;
    throw new Error(body?.error ?? error.message);
  }
  return data as { sent: boolean };
}

/** Access token for calling our own functions (the scanner) as the signed-in person. */
export async function accessToken(): Promise<string | undefined> {
  return (await getSession())?.access_token;
}
