// The three tabs: Home (balance cards), Activity (search + chart), People (balances + summary).

import { useMemo, useRef, useState } from "react";
import { expenseShares, netBalances, simplifyDebts } from "../lib/balances.ts";
import { CATEGORY_ICON } from "../lib/categories.ts";
import { formatCents } from "../lib/money.ts";
import { actions, useAppState } from "../lib/store.ts";
import type { Category, Group } from "../lib/types.ts";
import { Chips, DivergingBar, haptic, Icon, RoundButton, Sheet, useNav, useSheetClose } from "../ui/kit.tsx";
import { GroupSheet, SummaryTable } from "./GroupSheet.tsx";
import { ImportSplitwise } from "./ImportSplitwise.tsx";
import { ActivityRow, activityOf, nameIn, NewGroup, shortDate } from "./shared.tsx";

// ---------- Home ----------
export function Home({ groups }: { groups: Group[] }) {
  const nav = useNav();
  const [revealed, setRevealed] = useState(false);
  const [page, setPage] = useState(0);
  const pressTimer = useRef<number>(0);
  const me = groups[0] ? nameIn(groups[0], groups[0].meId) : "You";

  const startPress = () => (pressTimer.current = window.setTimeout(() => { haptic(30); actions.resetDemo(); nav.toast("Demo data reset"); }, 600));
  const endPress = () => clearTimeout(pressTimer.current);

  return (
    <div className="tab-page">
      <header className="home-head">
        <span className="avatar" aria-label={`Signed in as ${me}`}>{me.slice(0, 1)}</span>
        <span className="wordmark" onPointerDown={startPress} onPointerUp={endPress} onPointerLeave={endPress}>Allsquare</span>
        <RoundButton icon="bell" label="Coming up" onClick={() => nav.open(<ComingUp />)} />
      </header>

      {groups.length === 0 ? (
        <div className="empty-card">
          <p className="serif big">Split bills, free.</p>
          <p className="muted">Start a group for roommates, a trip or a dinner.</p>
          <button type="button" className="primary" onClick={() => nav.open(<NewGroup />)}>New group</button>
          <button type="button" className="secondary" onClick={() => nav.open(<ImportSplitwise />)}>Import from Splitwise</button>
        </div>
      ) : (
        <>
          <div className="cards" onScroll={(e) => setPage(Math.round(e.currentTarget.scrollLeft / e.currentTarget.clientWidth))}>
            {groups.map((g) => <BalanceCard key={g.id} group={g} revealed={revealed} onEye={() => (haptic(), setRevealed(!revealed))} />)}
          </div>
          <div className="dashes" aria-hidden>{groups.map((g, i) => <span key={g.id} className={i === page ? "on" : ""} />)}</div>
        </>
      )}

      <h3 className="section-title">Groups ›</h3>
      <ul className="group-list">
        {groups.map((g) => {
          const mine = netBalances(g)[g.meId] ?? 0;
          return (
            <li key={g.id}>
              <button type="button" className="group-row" onClick={() => nav.open(<GroupSheet groupId={g.id} />)}>
                <span className="dots" aria-hidden>{g.members.slice(0, 3).map((m, i) => <span key={m.id} style={{ zIndex: 3 - i }}>{m.name.slice(0, 1)}</span>)}</span>
                <span className="grow">
                  <span className="arow-title">{g.name}</span>
                  <span className="arow-sub">{g.members.length} members</span>
                </span>
                <span className={`arow-amt ${mine > 0 ? "pos" : mine < 0 ? "neg" : "muted"}`}>
                  {mine > 0 ? "+" : mine < 0 ? "−" : ""}{formatCents(Math.abs(mine), g.currency)}
                </span>
              </button>
            </li>
          );
        })}
        <li>
          <button type="button" className="group-row new" onClick={() => nav.open(<NewGroup />)}>
            <span className="dots" aria-hidden><span>+</span></span>
            <span className="grow"><span className="arow-title">New group</span></span>
          </button>
        </li>
      </ul>

      <h3 className="section-title">Recent ›</h3>
      <ul className="alist">{activityOf(groups).slice(0, 3).map((it) => <ActivityRow key={it.kind === "expense" ? it.e.id : it.s.id} item={it} showGroup={groups.length > 1} />)}</ul>
    </div>
  );
}

function BalanceCard({ group, revealed, onEye }: { group: Group; revealed: boolean; onEye: () => void }) {
  const net = netBalances(group);
  const transfers = simplifyDebts(net);
  const mine = net[group.meId] ?? 0;
  const owedToMe = transfers.filter((t) => t.to === group.meId);
  const iOwe = transfers.filter((t) => t.from === group.meId);
  const sum = (ts: typeof transfers) => ts.reduce((a, t) => a + t.cents, 0);
  const names = (ids: string[]) => ids.map((id) => nameIn(group, id)).join(" and ").replace(/ and (?=.* and )/g, ", ");
  const max = Math.max(1, ...Object.values(net).map(Math.abs));
  const sub = owedToMe.length ? `From ${names(owedToMe.map((t) => t.from))}` : iOwe.length ? `To ${names(iOwe.map((t) => t.to))}` : "Nothing to settle";

  return (
    <article className="bcard" aria-label={`${group.name} balance`}>
      <div className="bcard-hidden">
        <span className="kicker on-dark">{group.name}</span>
        <span className="mask serif">•••••</span>
        <span className="emboss serif">Allsquare</span>
      </div>
      <div className={`bcard-revealed ${mine < 0 ? "neg" : ""} ${revealed ? "shown" : ""}`} aria-hidden={!revealed}>
        <span className="kicker on-dark">{group.name}</span>
        <span className="bcard-label">{mine > 0 ? "You're owed" : mine < 0 ? "You owe" : "All square"}</span>
        <span className="bcard-amt serif">{formatCents(Math.abs(mine), group.currency)}</span>
        <span className="bcard-sub">{sub}</span>
        <div className="bcard-bars">
          {group.members.slice(0, 5).map((m, i) => (
            <DivergingBar key={m.id} onDark name={m.id === group.meId ? "You" : m.name} cents={net[m.id] ?? 0} max={max} delay={revealed ? 120 + i * 90 : 0}
              label={`${(net[m.id] ?? 0) > 0 ? "+" : (net[m.id] ?? 0) < 0 ? "−" : ""}${formatCents(Math.abs(net[m.id] ?? 0), group.currency)}`} />
          ))}
        </div>
        <div className="tiles">
          <div className="tile glass-dark"><span>You're owed</span><b>{formatCents(sum(owedToMe), group.currency)}</b></div>
          <div className="tile glass-dark"><span>You owe</span><b>{formatCents(sum(iOwe), group.currency)}</b></div>
        </div>
      </div>
      <RoundButton dark icon={revealed ? "eyeOff" : "eye"} label={revealed ? "Hide balance" : "Show balance"} onClick={onEye} className="eye" />
    </article>
  );
}

function ComingUp() {
  return <Sheet><ComingUpBody /></Sheet>;
}
function ComingUpBody() {
  const { groups } = useAppState();
  const close = useSheetClose();
  const upcoming = groups.flatMap((g) => g.recurring.map((r) => ({ g, r }))).sort((a, b) => a.r.nextDate.localeCompare(b.r.nextDate));
  const owed = groups.flatMap((g) => simplifyDebts(netBalances(g)).filter((t) => t.to === g.meId).map((t) => ({ g, t })));
  return (
    <div className="sheet-body">
      <div className="sheet-top"><button type="button" className="round surface2" aria-label="Close" onClick={close}><Icon name="x" size={20} /></button></div>
      <h2 className="title">Coming up</h2>
      <h3 className="section-title">Repeating expenses</h3>
      {upcoming.length === 0 ? <p className="muted pad-s">Nothing repeating yet. Choose "Monthly" when you add rent or Wi-Fi.</p> : (
        <ul className="plain">{upcoming.map(({ g, r }) => <li key={r.id}><span>{r.template.description} · {g.name}</span><span>{shortDate(r.nextDate)}</span></li>)}</ul>
      )}
      <h3 className="section-title">Waiting to be paid back</h3>
      {owed.length === 0 ? <p className="muted pad-s">Nobody owes you right now.</p> : (
        <ul className="plain">{owed.map(({ g, t }) => <li key={g.id + t.from}><span>{nameIn(g, t.from)} · {g.name}</span><span className="pos">{formatCents(t.cents, g.currency)}</span></li>)}</ul>
      )}
    </div>
  );
}

// ---------- Activity ----------
export function Activity({ groups }: { groups: Group[] }) {
  const [query, setQuery] = useState("");
  const [groupId, setGroupId] = useState("all");
  const [monthOffset, setMonthOffset] = useState(0);
  const shown = groupId === "all" ? groups : groups.filter((g) => g.id === groupId);
  const q = query.trim().toLowerCase();
  const items = activityOf(shown).filter((it) => {
    if (!q) return true;
    const g = it.group;
    const text = it.kind === "expense"
      ? [it.e.description, it.e.category, it.e.notes ?? "", ...Object.keys(it.e.payers).map((id) => nameIn(g, id)), (it.e.totalCents / 100).toFixed(2)].join(" ")
      : [nameIn(g, it.s.from), nameIn(g, it.s.to), "payment settle", (it.s.cents / 100).toFixed(2)].join(" ");
    return text.toLowerCase().includes(q);
  });

  const month = useMemo(() => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() + monthOffset);
    return d.toISOString().slice(0, 7);
  }, [monthOffset]);
  const byCategory = useMemo(() => {
    const totals = new Map<Category, number>();
    for (const g of shown) for (const e of g.expenses) {
      if (!e.date.startsWith(month)) continue;
      const mine = expenseShares(e)[g.meId] ?? 0;
      if (mine) totals.set(e.category, (totals.get(e.category) ?? 0) + mine);
    }
    return [...totals.entries()].sort((a, b) => b[1] - a[1]);
  }, [shown, month]);
  const monthTotal = byCategory.reduce((a, [, c]) => a + c, 0);
  const currency = shown[0]?.currency ?? "CAD";
  const label = new Date(month + "-15").toLocaleDateString("en-CA", { month: "long", year: "numeric" });

  return (
    <div className="tab-page">
      <h1 className="tab-title">Activity</h1>
      <label className="search">
        <Icon name="search" size={18} />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search expenses, people, amounts" aria-label="Search" />
        {query && <button type="button" className="mini-x" aria-label="Clear search" onClick={() => setQuery("")}>×</button>}
      </label>
      {groups.length > 1 && (
        <Chips small options={[{ id: "all", label: "All groups" }, ...groups.map((g) => ({ id: g.id, label: g.name }))]} selected={[groupId]} onToggle={setGroupId} />
      )}

      {!q && (
        <section className="card-light chart">
          <div className="chart-head">
            <button type="button" className="round surface2" aria-label="Previous month" onClick={() => setMonthOffset(monthOffset - 1)}><Icon name="back" size={18} /></button>
            <div className="chart-title">
              <span className="kicker">Your spending · {label}</span>
              <span className="serif chart-total">{formatCents(monthTotal, currency)}</span>
            </div>
            <button type="button" className="round surface2" aria-label="Next month" disabled={monthOffset >= 0} onClick={() => setMonthOffset(monthOffset + 1)}><Icon name="chevron" size={18} /></button>
          </div>
          {byCategory.length === 0 ? <p className="muted pad-s">No spending this month.</p> : byCategory.map(([cat, cents]) => (
            <div className="cat-bar" key={cat}>
              <span className="cat-name">{CATEGORY_ICON[cat]} {cat}</span>
              <span className="cat-track"><span style={{ width: `${(cents / byCategory[0][1]) * 100}%` }} /></span>
              <span className="cat-amt">{formatCents(cents, currency)}</span>
            </div>
          ))}
        </section>
      )}

      <h3 className="section-title">{q ? `${items.length} result${items.length === 1 ? "" : "s"}` : "All activity ›"}</h3>
      {items.length === 0 ? <p className="muted pad-s">{q ? "Nothing matches that." : "Nothing here yet."}</p> : (
        <ul className="alist">{items.map((it) => <ActivityRow key={it.kind === "expense" ? it.e.id : it.s.id} item={it} showGroup={groupId === "all" && groups.length > 1} />)}</ul>
      )}
    </div>
  );
}

// ---------- People ----------
export function People({ groups }: { groups: Group[] }) {
  const nav = useNav();
  const [groupId, setGroupId] = useState(groups[0]?.id);
  const g = groups.find((x) => x.id === groupId) ?? groups[0];
  if (!g) return <div className="tab-page"><h1 className="tab-title">People</h1><p className="muted">Create a group first.</p></div>;
  const net = netBalances(g);
  const max = Math.max(1, ...Object.values(net).map(Math.abs));
  return (
    <div className="tab-page">
      <h1 className="tab-title">People</h1>
      <p className="muted subtitle">Balances always add up to zero</p>
      {groups.length > 1 && <Chips small options={groups.map((x) => ({ id: x.id, label: x.name }))} selected={[g.id]} onToggle={setGroupId} />}
      <section className="card-light">
        {g.members.map((m, i) => (
          <DivergingBar key={m.id} name={m.id === g.meId ? "You" : m.name} cents={net[m.id] ?? 0} max={max} delay={120 + i * 90}
            label={`${(net[m.id] ?? 0) > 0 ? "+" : (net[m.id] ?? 0) < 0 ? "−" : ""}${formatCents(Math.abs(net[m.id] ?? 0), g.currency)}`} />
        ))}
      </section>
      <h3 className="section-title">Trip summary ›</h3>
      <SummaryTable group={g} />
      <button type="button" className="secondary wide" onClick={() => nav.open(<GroupSheet groupId={g.id} />)}>Open {g.name}</button>
    </div>
  );
}
