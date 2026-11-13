// One group: your net, everyone's bars, settle-up suggestions, expenses, and the + menu.

import { useState } from "react";
import { netBalances, simplifyDebts, summary } from "../lib/balances.ts";
import { groupToCsv, payMessage } from "../lib/export.ts";
import { cleanPhone, looksLikeEmail, looksLikePhone } from "../lib/messaging.ts";
import { formatCents, parsePercent } from "../lib/money.ts";
import { actions, useAppState, useStore } from "../lib/store.ts";
import type { Group, Split } from "../lib/types.ts";
import { Chips, ConfirmButton, DivergingBar, haptic, Icon, Sheet, shareText, useNav, useSheetClose } from "../ui/kit.tsx";
import { AddExpense } from "./AddExpense.tsx";
import { ActivityRow, activityOf, nameIn } from "./shared.tsx";
import { ReceiptFlow, ReceiptSession } from "./ReceiptFlow.tsx";
import { InviteSheet, SendSheet } from "./Send.tsx";
import { Settle } from "./Settle.tsx";

export function GroupSheet({ groupId }: { groupId: string }) {
  return <Sheet><GroupBody groupId={groupId} /></Sheet>;
}

function splitCaption(g: Group) {
  const s = g.defaultSplit;
  if (!s || s.kind === "equal") return "Equal split by default";
  if (s.kind === "percent") return Object.entries(s.percents).map(([id, p]) => `${nameIn(g, id)} ${p / 100}%`).join(" / ");
  if (s.kind === "shares") return Object.entries(s.weights).map(([id, w]) => `${nameIn(g, id)} ×${w}`).join(" / ");
  return "Custom default split";
}

function GroupBody({ groupId }: { groupId: string }) {
  const { groups } = useAppState();
  const nav = useNav();
  const close = useSheetClose();
  const { mode } = useStore();
  const [fan, setFan] = useState(false);
  const g = groups.find((x) => x.id === groupId);
  if (!g) return <p className="pad muted">This group isn't here any more.</p>;

  const net = netBalances(g);
  const transfers = simplifyDebts(net);
  const mine = net[g.meId] ?? 0;
  const max = Math.max(1, ...Object.values(net).map(Math.abs));
  const items = activityOf([g]);

  const fanAction = (fn: () => void) => () => { setFan(false); fn(); };
  return (
    <div className="sheet-body group-body">
      <div className="sheet-top">
        <button type="button" className="round surface2" aria-label="Close" onClick={close}><Icon name="x" size={20} /></button>
        <span className="top-actions">
          {mode === "cloud" && <button type="button" className="round surface2" aria-label="Invite people" onClick={() => nav.open(<InviteSheet groupId={g.id} />)}><Icon name="people" size={20} /></button>}
          <button type="button" className="round surface2" aria-label="Group settings" onClick={() => nav.open(<GroupSettings groupId={g.id} />)}><Icon name="gear" size={20} /></button>
        </span>
      </div>
      <span className="kicker">{g.members.length} members</span>
      <h2 className="title">{g.name}</h2>
      <p className={`big-number serif ${mine > 0 ? "pos" : mine < 0 ? "neg" : ""}`}>{formatCents(Math.abs(mine), g.currency)}</p>
      <p className="muted caption">{mine > 0 ? "you're owed" : mine < 0 ? "you owe" : "all square"}</p>

      <div className="card-light">
        {g.members.map((m, i) => (
          <DivergingBar key={m.id} name={m.id === g.meId ? "You" : m.name} cents={net[m.id] ?? 0} max={max} delay={120 + i * 90}
            label={`${(net[m.id] ?? 0) > 0 ? "+" : (net[m.id] ?? 0) < 0 ? "−" : ""}${formatCents(Math.abs(net[m.id] ?? 0), g.currency)}`} />
        ))}
      </div>

      {(g.receipts?.length ?? 0) > 0 && (
        <>
          <h3 className="section-title">Picking items ›</h3>
          <ul className="settle-list">
            {g.receipts!.map((r) => {
              const picked = new Set(r.claims.map((c) => c.memberId)).size;
              return (
                <li key={r.id}>
                  <span className="grow"><b>{r.receipt.store}</b><span className="tiny-link muted">{picked} of {g.members.length} have picked</span></span>
                  <span className="amt">{formatCents(r.receipt.totalCents + r.tipCents, g.currency)}</span>
                  <button type="button" className="settle-pill" onClick={() => nav.open(<ReceiptSession groupId={g.id} receiptId={r.id} />)}>Open</button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <h3 className="section-title">Settle up ›</h3>
      {transfers.length === 0 ? <p className="muted pad-s">Everyone is square.</p> : (
        <ul className="settle-list">
          {transfers.map((t) => (
            <li key={t.from + t.to}>
              <span className="grow">
                <b>{t.from === g.meId ? "You" : nameIn(g, t.from)}</b> → <b>{t.to === g.meId ? "You" : nameIn(g, t.to)}</b>
                {t.from === g.meId && (
                  <button type="button" className="tiny-link" onClick={() => shareText(payMessage(g, nameIn(g, t.to), t.cents), nav, "e-Transfer note copied")}>Copy e-Transfer note</button>
                )}
                {t.to === g.meId && (
                  <button type="button" className="tiny-link" onClick={() => nav.open(<SendSheet groupId={g.id} memberId={t.from} purpose={{ kind: "reminder", cents: t.cents }} />)}>Send a reminder</button>
                )}
              </span>
              <span className="amt">{formatCents(t.cents, g.currency)}</span>
              <button type="button" className="settle-pill" onClick={() => nav.open(<Settle groupId={g.id} from={t.from} to={t.to} cents={t.cents} />)}>Settle</button>
            </li>
          ))}
        </ul>
      )}

      <h3 className="section-title">Expenses ›</h3>
      {items.length === 0 ? <p className="muted pad-s">No expenses yet. Tap + to add one.</p> : (
        <ul className="alist">{items.map((it) => <ActivityRow key={it.kind === "expense" ? it.e.id : it.s.id} item={it} />)}</ul>
      )}
      <div className="spacer" />

      <div className="group-foot">
        <span className="glass caption-capsule">{g.currency} · {splitCaption(g)}</span>
      </div>
      {fan && <div className="veil" onClick={() => setFan(false)} />}
      <div className={`fan ${fan ? "open" : ""}`}>
        <div className="fan-items" aria-hidden={!fan}>
          {[
            { label: "Scan receipt", icon: "scan", run: () => nav.open(<ReceiptFlow groupId={g.id} />) },
            { label: "Settle up", icon: "settle", run: () => nav.open(<Settle groupId={g.id} />) },
            { label: "Add expense", icon: "plus", run: () => nav.open(<AddExpense groupId={g.id} />) },
          ].map((a, i) => (
            <button type="button" key={a.label} className="fan-item" style={{ transitionDelay: fan ? `${(2 - i) * 45}ms` : "0ms" }} tabIndex={fan ? 0 : -1} onClick={fanAction(a.run)}>
              <span className="fan-label">{a.label}</span>
              <span className="fan-circle"><Icon name={a.icon} size={22} /></span>
            </button>
          ))}
        </div>
        <button type="button" className="fan-main" aria-label={fan ? "Close menu" : "Add"} aria-expanded={fan} onClick={() => (haptic(), setFan(!fan))}>
          <Icon name="plus" size={28} />
        </button>
      </div>
    </div>
  );
}

// ---------- Group settings: who you are, people, default split, export ----------
function GroupSettings({ groupId }: { groupId: string }) {
  return <Sheet surface><SettingsBody groupId={groupId} /></Sheet>;
}

function SettingsBody({ groupId }: { groupId: string }) {
  const { groups } = useAppState();
  const nav = useNav();
  const close = useSheetClose();
  const { mode } = useStore();
  const g = groups.find((x) => x.id === groupId);
  const [newName, setNewName] = useState("");
  const [newContact, setNewContact] = useState("");
  const init = g?.defaultSplit;
  const [kind, setKind] = useState<Split["kind"]>(init?.kind === "percent" || init?.kind === "shares" ? init.kind : "equal");
  const [percents, setPercents] = useState<Record<string, string>>(init?.kind === "percent" ? Object.fromEntries(Object.entries(init.percents).map(([k, v]) => [k, String(v / 100)])) : {});
  const [weights, setWeights] = useState<Record<string, number>>(init?.kind === "shares" ? init.weights : {});
  if (!g) return null;

  const percentSum = g.members.reduce((a, m) => a + (parsePercent(percents[m.id] ?? "") ?? 0), 0);
  function saveDefault() {
    if (!g) return;
    if (kind === "equal") actions.setDefaultSplit(g.id, undefined);
    else if (kind === "percent") {
      if (percentSum !== 10000) return nav.toast(`Percents add to ${percentSum / 100}%, need 100%`);
      actions.setDefaultSplit(g.id, { kind, percents: Object.fromEntries(g.members.map((m) => [m.id, parsePercent(percents[m.id] ?? "") ?? 0]).filter(([, v]) => (v as number) > 0)) });
    } else actions.setDefaultSplit(g.id, { kind: "shares", weights: Object.fromEntries(g.members.map((m) => [m.id, weights[m.id] ?? 1])) });
    nav.toast("Default split saved");
  }

  const csvName = `${g.name.replace(/[^\w]+/g, "-")}.csv`;
  return (
    <div className="sheet-body">
      <div className="sheet-top">
        <button type="button" className="round surface2" aria-label="Close" onClick={close}><Icon name="x" size={20} /></button>
      </div>
      <h2 className="title">Group settings</h2>

      {mode !== "cloud" && (
        <>
          <h3 className="section-title">Which one is you?</h3>
          <Chips options={g.members.map((m) => ({ id: m.id, label: m.name }))} selected={[g.meId]} onToggle={(id) => actions.setMe(g.id, id)} />
        </>
      )}

      <h3 className="section-title">People</h3>
      <ul className="plain">
        {g.members.map((m) => (
          <li key={m.id}>
            <button type="button" className="member-row" onClick={() => nav.open(<MemberSheet groupId={g.id} memberId={m.id} />)}>
              <b>{m.name}{m.id === g.meId ? " (you)" : ""}</b>
              <small className="muted">{[m.email, m.phone].filter(Boolean).join(" · ") || "Add email or phone"}</small>
            </button>
            {mode === "cloud" && (m.userId ? <span className="kicker">joined</span>
              : <button type="button" className="settle-pill" onClick={() => nav.open(<SendSheet groupId={g.id} memberId={m.id} purpose={{ kind: "invite" }} />)}>Invite</button>)}
          </li>
        ))}
      </ul>
      {mode === "cloud" && <button type="button" className="secondary" onClick={() => nav.open(<InviteSheet groupId={g.id} />)}>Share the invite link</button>}

      <h3 className="section-title">Add a person</h3>
      <div className="add-person">
        <input className="field" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Name" aria-label="New person's name" />
        <input className="field" value={newContact} onChange={(e) => setNewContact(e.target.value)} placeholder="Email or phone (optional)" aria-label="New person's email or phone" />
        <button type="button" className="settle-pill" disabled={!newName.trim() || g.members.some((m) => m.name.toLowerCase() === newName.trim().toLowerCase()) || (newContact.trim() !== "" && !looksLikeEmail(newContact) && !looksLikePhone(newContact))}
          onClick={() => {
            const c = newContact.trim();
            actions.addMember(g.id, newName.trim(), looksLikeEmail(c) ? c : undefined, !looksLikeEmail(c) && looksLikePhone(c) ? cleanPhone(c) : undefined);
            setNewName(""); setNewContact("");
          }}>Add</button>
      </div>

      <h3 className="section-title">Default split for new expenses</h3>
      <Chips small options={[{ id: "equal", label: "Equal" }, { id: "percent", label: "Percent" }, { id: "shares", label: "Shares" }]} selected={[kind]} onToggle={(k) => setKind(k as Split["kind"])} />
      {kind === "percent" && g.members.map((m) => (
        <label className="per-person" key={m.id}>
          <span>{m.name}</span>
          <input inputMode="decimal" placeholder="0" value={percents[m.id] ?? ""} onChange={(e) => setPercents({ ...percents, [m.id]: e.target.value })} />
          <span className="unit">%</span>
        </label>
      ))}
      {kind === "shares" && g.members.map((m) => (
        <div className="per-person" key={m.id}>
          <span>{m.name}</span>
          <div className="stepper">
            <button type="button" aria-label={`Fewer shares for ${m.name}`} onClick={() => setWeights({ ...weights, [m.id]: Math.max(0, (weights[m.id] ?? 1) - 1) })}>−</button>
            <span>{weights[m.id] ?? 1}</span>
            <button type="button" aria-label={`More shares for ${m.name}`} onClick={() => setWeights({ ...weights, [m.id]: (weights[m.id] ?? 1) + 1 })}>+</button>
          </div>
        </div>
      ))}
      <button type="button" className="secondary" onClick={saveDefault}>Save default split</button>

      <h3 className="section-title">Summary</h3>
      <SummaryTable group={g} />

      <h3 className="section-title">Export</h3>
      <div className="button-row">
        <button type="button" className="secondary" onClick={() => downloadCsv(csvName, groupToCsv(g), nav)}>Download CSV</button>
        <button type="button" className="secondary" onClick={() => shareText(groupToCsv(g), nav, "CSV copied")}>Copy CSV</button>
      </div>

      {g.recurring.length > 0 && (
        <>
          <h3 className="section-title">Repeating expenses</h3>
          <ul className="plain">
            {g.recurring.map((r) => (
              <li key={r.id}>
                <span>{r.template.description} · every {r.every} · next {r.nextDate}</span>
                <button type="button" className="link" onClick={() => actions.stopRecurring(g.id, r.id)}>Stop</button>
              </li>
            ))}
          </ul>
        </>
      )}

      {mode === "cloud" && !g.createdByMe && (
        <ConfirmButton className="danger-btn" label="Leave group" confirmLabel="Tap again to leave (your expenses stay for the others)"
          onConfirm={() => { actions.leaveGroup(g.id); nav.closeAll(); nav.toast("You left the group"); }} />
      )}
      {(mode !== "cloud" || g.createdByMe) && (
        <ConfirmButton className="danger-btn" label="Delete group" confirmLabel={mode === "cloud" ? "Tap again to delete it for everyone" : "Tap again to delete the whole group"}
          onConfirm={() => { actions.deleteGroup(g.id); nav.closeAll(); nav.toast("Group deleted"); }} />
      )}
    </div>
  );
}

// ---------- One person's name, email and phone ----------
function MemberSheet({ groupId, memberId }: { groupId: string; memberId: string }) {
  return <Sheet surface><MemberBody groupId={groupId} memberId={memberId} /></Sheet>;
}

function MemberBody({ groupId, memberId }: { groupId: string; memberId: string }) {
  const { groups } = useAppState();
  const nav = useNav();
  const close = useSheetClose();
  const m = groups.find((x) => x.id === groupId)?.members.find((x) => x.id === memberId);
  const [name, setName] = useState(m?.name ?? "");
  const [email, setEmail] = useState(m?.email ?? "");
  const [phone, setPhone] = useState(m?.phone ?? "");
  if (!m) return null;
  const okEmail = email.trim() === "" || looksLikeEmail(email);
  const okPhone = phone.trim() === "" || looksLikePhone(phone);
  return (
    <div className="sheet-body">
      <div className="sheet-top"><button type="button" className="round surface2" aria-label="Close" onClick={close}><Icon name="x" size={20} /></button></div>
      <h2 className="title">{m.name}</h2>
      <p className="muted small-text">Used for invites, "pick your items" links and reminders. Only people in this group can see them.</p>
      <label className="field-label">Name<input className="field" value={name} onChange={(e) => setName(e.target.value)} /></label>
      <label className="field-label">Email<input className="field" type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" /></label>
      {!okEmail && <p className="warn-text small-text">That email doesn't look right.</p>}
      <label className="field-label">Phone<input className="field" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="416 555 0199" /></label>
      {!okPhone && <p className="warn-text small-text">That phone number looks too short.</p>}
      <button type="button" className="primary" disabled={!name.trim() || !okEmail || !okPhone}
        onClick={() => { actions.updateMember(groupId, memberId, { name: name.trim(), email: email.trim(), phone: phone.trim() ? cleanPhone(phone) : "" }); nav.toast("Saved"); close(); }}>Save</button>
    </div>
  );
}

export function SummaryTable({ group }: { group: Group }) {
  const rows = summary(group);
  const total = rows.reduce((a, r) => a + r.paid, 0);
  return (
    <table className="summary">
      <thead><tr><th>Person</th><th>Paid</th><th>Share</th><th>Balance</th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.member.id}>
            <td>{r.member.name}</td>
            <td>{formatCents(r.paid, group.currency)}</td>
            <td>{formatCents(r.share, group.currency)}</td>
            <td className={r.net > 0 ? "pos" : r.net < 0 ? "neg" : ""}>{r.net > 0 ? "+" : r.net < 0 ? "−" : ""}{formatCents(Math.abs(r.net), group.currency)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot><tr><td>Total spent</td><td colSpan={3}>{formatCents(total, group.currency)}</td></tr></tfoot>
    </table>
  );
}

function downloadCsv(name: string, csv: string, nav: ReturnType<typeof useNav>) {
  try {
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: name });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    nav.toast("CSV downloaded", "copy");
  } catch {
    nav.toast("Download is blocked here. Use Copy CSV.", "copy");
  }
}
