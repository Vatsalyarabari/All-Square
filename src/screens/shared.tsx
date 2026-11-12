// Rows and small sheets used on several screens.

import { useState } from "react";
import { expenseShares, involvement } from "../lib/balances.ts";
import { CATEGORY_ICON } from "../lib/categories.ts";
import { CURRENCIES, formatCents } from "../lib/money.ts";
import { actions, useAppState } from "../lib/store.ts";
import type { Expense, Group, Settlement } from "../lib/types.ts";
import { ConfirmButton, Icon, Sheet, useNav, useSheetClose } from "../ui/kit.tsx";
import { AddExpense } from "./AddExpense.tsx";
import { ImportSplitwise } from "./ImportSplitwise.tsx";

export const nameIn = (g: Group, id: string) => g.members.find((m) => m.id === id)?.name ?? "Someone";

export type ActivityItem =
  | { kind: "expense"; group: Group; e: Expense; date: string; at: number }
  | { kind: "settle"; group: Group; s: Settlement; date: string; at: number };

export function activityOf(groups: Group[]): ActivityItem[] {
  return groups
    .flatMap((group) => [
      ...group.expenses.map((e) => ({ kind: "expense" as const, group, e, date: e.date, at: e.createdAt })),
      ...group.settlements.map((s) => ({ kind: "settle" as const, group, s, date: s.date, at: s.createdAt })),
    ])
    .sort((a, b) => b.date.localeCompare(a.date) || b.at - a.at);
}

export function ActivityRow({ item, showGroup }: { item: ActivityItem; showGroup?: boolean }) {
  const nav = useNav();
  const g = item.group;
  if (item.kind === "settle") {
    const s = item.s;
    const mine = s.from === g.meId || s.to === g.meId;
    return (
      <li className="arow settle-row">
        <span className="cat-dot" aria-hidden>⇄</span>
        <span className="arow-main">
          <span className="arow-title">{nameIn(g, s.from)} paid {nameIn(g, s.to)}</span>
          <span className="arow-sub">{shortDate(s.date)}{showGroup ? ` · ${g.name}` : ""}</span>
        </span>
        <span className="arow-side">
          <span className="kicker">{mine ? "payment" : "not involved"}</span>
          <span className="arow-amt">{formatCents(s.cents, g.currency)}</span>
        </span>
        <ConfirmButton className="mini-x" label="×" confirmLabel="Delete" onConfirm={() => actions.deleteSettlement(g.id, s.id)} />
      </li>
    );
  }
  const e = item.e;
  const inv = involvement(e, g.meId);
  const payers = Object.keys(e.payers);
  return (
    <li>
      <button type="button" className="arow" onClick={() => nav.open(<ExpenseDetail groupId={g.id} expenseId={e.id} />)}>
        <span className="cat-dot" aria-hidden>{CATEGORY_ICON[e.category]}</span>
        <span className="arow-main">
          <span className="arow-title">{e.description}{e.recurringId && <Icon name="repeat" size={13} style={{ marginLeft: 6, verticalAlign: -1, opacity: 0.5 }} />}</span>
          <span className="arow-sub">
            {payers.length > 1 ? `${payers.length} people paid` : `${payers[0] === g.meId ? "You" : nameIn(g, payers[0])} paid`} {formatCents(e.totalCents, g.currency)}
            {showGroup ? ` · ${g.name}` : ` · ${shortDate(e.date)}`}
          </span>
        </span>
        <span className="arow-side">
          <span className="kicker">{inv.kind === "lent" ? "you lent" : inv.kind === "owe" ? "you owe" : "not involved"}</span>
          <span className={`arow-amt ${inv.kind === "lent" ? "pos" : inv.kind === "owe" ? "neg" : "muted"}`}>
            {inv.kind === "none" ? "—" : formatCents(inv.cents, g.currency)}
          </span>
        </span>
      </button>
    </li>
  );
}

export function shortDate(iso: string) {
  return new Date(iso + "T12:00:00").toLocaleDateString("en-CA", { month: "short", day: "numeric" });
}

// ---------- One expense in full ----------
export function ExpenseDetail({ groupId, expenseId }: { groupId: string; expenseId: string }) {
  return (
    <Sheet>
      <ExpenseDetailBody groupId={groupId} expenseId={expenseId} />
    </Sheet>
  );
}

function ExpenseDetailBody({ groupId, expenseId }: { groupId: string; expenseId: string }) {
  const { groups } = useAppState();
  const nav = useNav();
  const close = useSheetClose();
  const g = groups.find((x) => x.id === groupId);
  const e = g?.expenses.find((x) => x.id === expenseId);
  const [zoom, setZoom] = useState(false);
  if (!g || !e) return <p className="pad muted">This expense was deleted.</p>;
  const shares = expenseShares(e);
  const rec = e.recurringId ? g.recurring.find((r) => r.id === e.recurringId) : undefined;
  return (
    <div className="sheet-body">
      <div className="sheet-top">
        <button type="button" className="round surface2" aria-label="Close" onClick={close}><Icon name="x" size={20} /></button>
        <button type="button" className="pill-btn" onClick={() => nav.open(<AddExpense groupId={g.id} existing={e} />)}>Edit</button>
      </div>
      <span className="kicker">{CATEGORY_ICON[e.category]} {e.category} · {shortDate(e.date)}</span>
      <h2 className="title">{e.description}</h2>
      <p className="big-number serif">{formatCents(e.totalCents, g.currency)}</p>
      {e.foreign && <p className="muted">{formatCents(e.foreign.cents, e.foreign.currency)} {e.foreign.currency} at {e.foreign.rate} {g.currency}</p>}
      <h3 className="section-title">Paid</h3>
      <ul className="plain">
        {Object.entries(e.payers).map(([id, c]) => <li key={id}><span>{nameIn(g, id)}</span><span>{formatCents(c, g.currency)}</span></li>)}
      </ul>
      <h3 className="section-title">Shares</h3>
      <ul className="plain">
        {Object.entries(shares).map(([id, c]) => <li key={id}><span>{nameIn(g, id)}</span><span>{formatCents(c, g.currency)}</span></li>)}
      </ul>
      {e.itemized && (
        <>
          <h3 className="section-title">Items (with tax)</h3>
          <ul className="plain">
            {e.itemized.lines.map((l, i) => (
              <li key={i}>
                <span>{l.name}<small className="muted block">{l.who.map((id) => (id === g.meId ? "You" : nameIn(g, id))).join(", ")}</small></span>
                <span>{formatCents(l.cents, g.currency)}</span>
              </li>
            ))}
            {e.itemized.tipCents > 0 && <li><span>Tip</span><span>{formatCents(e.itemized.tipCents, g.currency)}</span></li>}
          </ul>
        </>
      )}
      {e.notes && (<><h3 className="section-title">Note</h3><p className="note-text">{e.notes}</p></>)}
      {e.photo && (
        <>
          <h3 className="section-title">Receipt</h3>
          <button type="button" className={`photo ${zoom ? "zoom" : ""}`} onClick={() => setZoom(!zoom)} aria-label="Enlarge receipt photo">
            <img src={e.photo} alt="Receipt" />
          </button>
        </>
      )}
      {rec && (
        <div className="helper static">
          <Icon name="repeat" size={16} /> Repeats every {rec.every}. Next on {shortDate(rec.nextDate)}.
          <button type="button" className="link" onClick={() => { actions.stopRecurring(g.id, rec.id); nav.toast("Won't repeat any more", "repeat"); }}>Stop</button>
        </div>
      )}
      <ConfirmButton className="danger-btn" label="Delete expense" confirmLabel="Tap again to delete"
        onConfirm={() => { actions.deleteExpense(g.id, e.id); close(); nav.toast("Expense deleted"); }} />
    </div>
  );
}

// ---------- New group ----------
export function NewGroup() {
  return <Sheet surface><NewGroupBody /></Sheet>;
}
function NewGroupBody() {
  const nav = useNav();
  const close = useSheetClose();
  const [name, setName] = useState("");
  const [people, setPeople] = useState(["", ""]);
  const [currency, setCurrency] = useState("CAD");
  const names = people.map((p) => p.trim()).filter(Boolean);
  const problem = !name.trim() ? "Name the group" : names.length < 2 ? "Add at least two people, you first"
    : new Set(names.map((n) => n.toLowerCase())).size !== names.length ? "Each person needs a different name" : null;
  return (
    <div className="sheet-body">
      <div className="sheet-top">
        <button type="button" className="round surface2" aria-label="Close" onClick={close}><Icon name="x" size={20} /></button>
      </div>
      <h2 className="title">New group</h2>
      <button type="button" className="helper" onClick={() => nav.open(<ImportSplitwise />)}>
        <Icon name="copy" size={16} /> Moving from Splitwise? Import a group instead
      </button>
      <input className="desc" value={name} onChange={(e) => setName(e.target.value)} placeholder="Roommates, a trip, a dinner…" aria-label="Group name" />
      <h3 className="section-title">People</h3>
      {people.map((p, i) => (
        <div className="per-person" key={i}>
          <input value={p} placeholder={i === 0 ? "Your name" : `Person ${i + 1}`} aria-label={i === 0 ? "Your name" : `Person ${i + 1}`}
            onChange={(e) => setPeople(people.map((x, j) => (j === i ? e.target.value : x)))} />
          {i > 1 && <button type="button" className="mini-x" aria-label="Remove" onClick={() => setPeople(people.filter((_, j) => j !== i))}>×</button>}
        </div>
      ))}
      <button type="button" className="link" onClick={() => setPeople([...people, ""])}>+ Add another person</button>
      <h3 className="section-title">Currency</h3>
      <select className="select" value={currency} onChange={(e) => setCurrency(e.target.value)} aria-label="Group currency">
        {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
      </select>
      <button type="button" className="primary" disabled={!!problem} onClick={() => { actions.createGroup(name.trim(), names, currency); close(); nav.toast("Group created"); }}>
        {problem ?? "Create group"}
      </button>
    </div>
  );
}
