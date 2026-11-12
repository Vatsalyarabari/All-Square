// Add or edit an expense: number pad for the amount, chips for people, then a swipe-up review.

import { useMemo, useState } from "react";
import { convert, sharesFor } from "../lib/balances.ts";
import { CATEGORY_ICON, guessCategory } from "../lib/categories.ts";
import { centsToInput, CURRENCIES, formatCents, parseCents, parsePercent, todayISO } from "../lib/money.ts";
import { allocate } from "../lib/split.ts";
import { shrinkImage } from "../lib/scanner.ts";
import { actions, useAppState } from "../lib/store.ts";
import { CATEGORIES, type Category, type Expense, type Group, type Split, type SplitKind } from "../lib/types.ts";
import { Chips, Icon, NumberPad, Sheet, useNav, useSheetClose } from "../ui/kit.tsx";
import { Review, ReviewRow } from "../ui/Review.tsx";

const KIND_LABEL: Record<SplitKind, string> = { equal: "Equal split", exact: "Exact amounts", percent: "By percent", shares: "By shares" };

export function AddExpense({ groupId, existing }: { groupId: string; existing?: Expense }) {
  return (
    <Sheet surface className="add-sheet">
      <AddExpenseBody groupId={groupId} existing={existing} />
    </Sheet>
  );
}

function initialFromSplit(group: Group, split: Split | undefined) {
  const ids = group.members.map((m) => m.id);
  const s = split ?? group.defaultSplit;
  return {
    kind: (s?.kind ?? "equal") as SplitKind,
    among: s?.kind === "equal" ? s.among.filter((id) => ids.includes(id)) : ids,
    exact: s?.kind === "exact" ? Object.fromEntries(Object.entries(s.shares).map(([k, v]) => [k, centsToInput(v)])) : {},
    percents: s?.kind === "percent" ? Object.fromEntries(Object.entries(s.percents).map(([k, v]) => [k, String(v / 100)])) : {},
    weights: s?.kind === "shares" ? { ...s.weights } : Object.fromEntries(ids.map((id) => [id, 1])),
  };
}

function AddExpenseBody({ groupId, existing }: { groupId: string; existing?: Expense }) {
  const { groups } = useAppState();
  const nav = useNav();
  const close = useSheetClose();
  const [gid, setGid] = useState(groupId);
  const group = groups.find((g) => g.id === gid) ?? groups[0];
  const ids = group.members.map((m) => m.id);
  const nameOf = (id: string) => group.members.find((m) => m.id === id)?.name ?? "?";

  const init = useMemo(() => initialFromSplit(group, existing?.split), [group.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const payerIds = existing ? Object.keys(existing.payers) : [group.meId];

  const [description, setDescription] = useState(existing?.description ?? "");
  const [category, setCategory] = useState<Category | null>(existing?.category ?? null);
  const [amount, setAmount] = useState(existing ? centsToInput(existing.foreign?.cents ?? existing.totalCents).replace(/\.00$/, "") : "");
  const [padOpen, setPadOpen] = useState(!existing);
  const [date, setDate] = useState(existing?.date ?? todayISO());
  const [currency, setCurrency] = useState(existing?.foreign?.currency ?? group.currency);
  const [rate, setRate] = useState(existing?.foreign ? String(existing.foreign.rate) : "");
  const [multiPay, setMultiPay] = useState(payerIds.length > 1);
  const [payer, setPayer] = useState(payerIds[0]);
  const [payAmounts, setPayAmounts] = useState<Record<string, string>>(
    existing && payerIds.length > 1 ? Object.fromEntries(Object.entries(existing.payers).map(([k, v]) => [k, centsToInput(v)])) : {},
  );
  const [kind, setKind] = useState<SplitKind>(init.kind);
  const [kindMenu, setKindMenu] = useState(false);
  const [among, setAmong] = useState<string[]>(init.among);
  const [exact, setExact] = useState<Record<string, string>>(init.exact);
  const [percents, setPercents] = useState<Record<string, string>>(init.percents);
  const [weights, setWeights] = useState<Record<string, number>>(init.weights);
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [photo, setPhoto] = useState(existing?.photo);
  const [repeat, setRepeat] = useState<"never" | "week" | "month">("never");
  const [panel, setPanel] = useState<"" | "category" | "more">("");

  const foreign = currency !== group.currency;
  const typedCents = parseCents(amount) ?? 0;
  const rateNum = Number(rate);
  const totalCents = foreign ? (rateNum > 0 ? convert(typedCents, rateNum) : 0) : typedCents;
  const shownCategory = category ?? guessCategory(description);

  // Typed per-person amounts are in the currency the expense was paid in; convert them exactly.
  const toGroupCents = (typed: Record<string, number>) => {
    if (!foreign) return typed;
    const keys = Object.keys(typed);
    const parts = allocate(totalCents, keys.map((k) => typed[k]));
    return Object.fromEntries(keys.map((k, i) => [k, parts[i]]));
  };

  const { split, payers, problem } = useMemo(() => {
    let problem: string | null = null;
    let split: Split | null = null;
    let payers: Record<string, number> = {};
    if (!typedCents) problem = "Enter an amount";
    else if (foreign && !(rateNum > 0)) problem = `Enter today's ${currency} → ${group.currency} rate`;

    if (kind === "equal") {
      split = { kind, among: ids.filter((id) => among.includes(id)) };
    } else if (kind === "shares") {
      const w = Object.fromEntries(ids.filter((id) => (weights[id] ?? 0) > 0).map((id) => [id, weights[id]]));
      if (!Object.keys(w).length) problem ??= "Give at least one person a share";
      split = { kind, weights: w };
    } else if (kind === "percent") {
      const p: Record<string, number> = {};
      for (const id of ids) {
        if (!percents[id]?.trim()) continue;
        const v = parsePercent(percents[id]);
        if (v === null) problem ??= `${nameOf(id)}'s percent isn't a number`;
        else if (v > 0) p[id] = v;
      }
      const sum = Object.values(p).reduce((a, b) => a + b, 0);
      if (sum !== 10000) problem ??= `Percents add to ${sum / 100}%, need 100%`;
      split = { kind, percents: p };
    } else {
      const typed: Record<string, number> = {};
      for (const id of ids) {
        if (!exact[id]?.trim()) continue;
        const v = parseCents(exact[id]);
        if (v === null) problem ??= `${nameOf(id)}'s amount isn't a number`;
        else if (v > 0) typed[id] = v;
      }
      const sum = Object.values(typed).reduce((a, b) => a + b, 0);
      if (typedCents && sum !== typedCents) problem ??= `${formatCents(typedCents - sum, currency)} left to assign`;
      split = { kind, shares: totalCents && sum === typedCents ? toGroupCents(typed) : typed };
    }

    if (!multiPay) payers = { [payer]: totalCents };
    else {
      const typed: Record<string, number> = {};
      for (const id of ids) {
        if (!payAmounts[id]?.trim()) continue;
        const v = parseCents(payAmounts[id]);
        if (v === null) problem ??= `${nameOf(id)}'s paid amount isn't a number`;
        else if (v > 0) typed[id] = v;
      }
      const sum = Object.values(typed).reduce((a, b) => a + b, 0);
      if (typedCents && sum !== typedCents) problem ??= `Payers add to ${formatCents(sum, currency)}, not ${formatCents(typedCents, currency)}`;
      payers = totalCents && sum === typedCents ? toGroupCents(typed) : typed;
    }
    return { split, payers, problem };
  }, [typedCents, totalCents, foreign, rateNum, kind, among, weights, percents, exact, multiPay, payer, payAmounts, group]); // eslint-disable-line react-hooks/exhaustive-deps

  let preview: Record<string, number> | null = null;
  let splitError: string | null = null;
  if (split && totalCents) {
    try {
      preview = sharesFor(split, totalCents);
    } catch (e) {
      splitError = (e as Error).message;
    }
  }
  const finalProblem = problem ?? (!description.trim() ? "Say what it was for" : splitError);

  function review() {
    if (finalProblem || !split || !preview) return;
    const expense = {
      id: existing?.id, description: description.trim(), date, payers, totalCents, split, category: shownCategory,
      notes: notes.trim() || undefined, photo,
      foreign: foreign ? { currency, cents: typedCents, rate: rateNum } : undefined,
      recurringId: existing?.recurringId, repeat,
    };
    const myNet = (payers[group.meId] ?? 0) - (preview[group.meId] ?? 0);
    const note = myNet > 0 ? `You'll be owed ${formatCents(myNet, group.currency)} more.` : myNet < 0 ? `You'll owe ${formatCents(-myNet, group.currency)} more.` : "Your balance doesn't change.";
    nav.open(
      <Review title={description.trim()} verb={existing ? "save" : "add"} toastText={existing ? "Expense updated" : "Expense added"}
        note={`${note} Balances in ${group.name} update for everyone.${repeat !== "never" ? ` Repeats every ${repeat}.` : ""}`}
        onConfirm={() => actions.saveExpense(group.id, expense)}>
        <ReviewRow label="Paid by" value={Object.keys(payers).map(nameOf).join(" & ")} />
        <ReviewRow label="Split" value={kind === "equal" ? `Equally, ${Object.keys(preview).length} ways` : KIND_LABEL[kind]} />
        <ReviewRow label="Amount" value={<b className="serif">{formatCents(totalCents, group.currency)}</b>} />
        {foreign && <ReviewRow indent label={`${formatCents(typedCents, currency)} ${currency}`} value={`@ ${rateNum} ${group.currency}`} />}
        {Object.entries(preview).map(([id, c]) => <ReviewRow key={id} indent label={nameOf(id)} value={formatCents(c, group.currency)} />)}
        <ReviewRow label="Category" value={`${CATEGORY_ICON[shownCategory]} ${shownCategory}`} />
      </Review>,
    );
  }

  async function pickPhoto(file: File | undefined) {
    if (!file) return;
    setPhoto(await shrinkImage(file));
  }

  const toggleAmong = (id: string) => {
    if (among.includes(id)) {
      if (among.length > 1) setAmong(among.filter((x) => x !== id)); // at least one must stay selected
    } else setAmong([...among, id]);
  };

  const people = group.members.map((m) => ({ id: m.id, label: m.id === group.meId ? `${m.name} (you)` : m.name }));

  return (
    <div className="add" onFocus={(e) => e.target instanceof HTMLInputElement && e.target.name !== "amount" && setPadOpen(false)}>
      <div className="add-scroll">
        <div className="sheet-top">
          <button type="button" className="round surface2" aria-label="Close" onClick={close}><Icon name="x" size={20} /></button>
          <div className="pill-wrap">
            <button type="button" className="pill-btn" aria-expanded={kindMenu} onClick={() => setKindMenu(!kindMenu)}>
              {KIND_LABEL[kind]} <Icon name="down" size={14} />
            </button>
            {kindMenu && (
              <div className="menu" role="menu">
                {(Object.keys(KIND_LABEL) as SplitKind[]).map((k) => (
                  <button type="button" role="menuitemradio" aria-checked={k === kind} key={k} onClick={() => (setKind(k), setKindMenu(false))}>
                    {KIND_LABEL[k]}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <h2 className="title">{existing ? "Edit expense" : "Add expense"}</h2>
        <input className="desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What was it for?" aria-label="Description"
          enterKeyHint="next" onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} onBlur={() => !amount && setPadOpen(true)} />

        <div className="detail-chips">
          <button type="button" className={`chip small ${panel === "category" ? "on" : ""}`} onClick={() => setPanel(panel === "category" ? "" : "category")}>
            {CATEGORY_ICON[shownCategory]} {shownCategory}
          </button>
          <label className="chip small date-chip">
            {date === todayISO() ? "Today" : new Date(date + "T12:00").toLocaleDateString("en-CA", { month: "short", day: "numeric" })}
            <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Date" />
          </label>
          <label className="chip small select-chip">
            {currency}
            <select value={currency} onChange={(e) => setCurrency(e.target.value)} aria-label="Currency">
              {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>
          <button type="button" className={`chip small ${panel === "more" || notes || photo || repeat !== "never" ? "on" : ""}`} onClick={() => setPanel(panel === "more" ? "" : "more")}>
            Note · Photo{!existing && " · Repeat"}
          </button>
        </div>

        {panel === "category" && (
          <Chips small options={CATEGORIES.map((c) => ({ id: c, label: `${CATEGORY_ICON[c]} ${c}` }))} selected={[shownCategory]} onToggle={(c) => (setCategory(c as Category), setPanel(""))} />
        )}
        {panel === "more" && (
          <div className="more">
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Add a note (optional)" rows={2} aria-label="Note" />
            <div className="more-row">
              <label className="chip small file-chip">
                <Icon name="camera" size={16} /> {photo ? "Change photo" : "Add receipt photo"}
                <input type="file" accept="image/*" capture="environment" onChange={(e) => pickPhoto(e.target.files?.[0])} />
              </label>
              {photo && <img className="thumb" src={photo} alt="Receipt" />}
              {photo && <button type="button" className="link" onClick={() => setPhoto(undefined)}>Remove</button>}
            </div>
            {!existing && (
              <div className="more-row">
                <Icon name="repeat" size={16} />
                <Chips small options={[{ id: "never", label: "Once" }, { id: "week", label: "Weekly" }, { id: "month", label: "Monthly" }]} selected={[repeat]} onToggle={(r) => setRepeat(r as typeof repeat)} />
              </div>
            )}
          </div>
        )}

        <button type="button" className={`row amount-row ${padOpen ? "active" : ""}`} onClick={() => setPadOpen(true)}>
          <span className="row-label">Amount</span>
          <span className="amount-value serif">
            {foreign ? currency + " " : "$"}{amount || "0"}{padOpen && <span className="caret" />}
          </span>
        </button>
        {foreign && (
          <label className="row rate-row">
            <span className="row-label">1 {currency} =</span>
            <input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value.replace(/[^\d.]/g, ""))} placeholder="rate" aria-label="Exchange rate" />
            <span className="muted">{group.currency}{totalCents ? ` · ${formatCents(totalCents, group.currency)}` : ""}</span>
          </label>
        )}

        <div className="row stack">
          <div className="row-head">
            <span className="row-label">Paid by</span>
            <button type="button" className="link" onClick={() => setMultiPay(!multiPay)}>{multiPay ? "One person" : "Several people"}</button>
          </div>
          {!multiPay ? (
            <Chips options={people} selected={[payer]} onToggle={setPayer} />
          ) : (
            group.members.map((m) => (
              <label className="per-person" key={m.id}>
                <span>{m.name}</span>
                <input inputMode="decimal" placeholder="0.00" value={payAmounts[m.id] ?? ""} onChange={(e) => setPayAmounts({ ...payAmounts, [m.id]: e.target.value })} />
              </label>
            ))
          )}
        </div>

        <div className="row stack">
          <span className="row-label">Split with</span>
          {kind === "equal" && <Chips options={people} selected={among} onToggle={toggleAmong} />}
          {kind === "exact" && group.members.map((m) => (
            <label className="per-person" key={m.id}>
              <span>{m.name}</span>
              <input inputMode="decimal" placeholder="0.00" value={exact[m.id] ?? ""} onChange={(e) => setExact({ ...exact, [m.id]: e.target.value })} />
            </label>
          ))}
          {kind === "percent" && group.members.map((m) => (
            <label className="per-person" key={m.id}>
              <span>{m.name}</span>
              <input inputMode="decimal" placeholder="0" value={percents[m.id] ?? ""} onChange={(e) => setPercents({ ...percents, [m.id]: e.target.value })} />
              <span className="unit">%</span>
            </label>
          ))}
          {kind === "shares" && group.members.map((m) => (
            <div className="per-person" key={m.id}>
              <span>{m.name}</span>
              <div className="stepper">
                <button type="button" aria-label={`Fewer shares for ${m.name}`} onClick={() => setWeights({ ...weights, [m.id]: Math.max(0, (weights[m.id] ?? 0) - 1) })}>−</button>
                <span aria-live="polite">{weights[m.id] ?? 0}</span>
                <button type="button" aria-label={`More shares for ${m.name}`} onClick={() => setWeights({ ...weights, [m.id]: (weights[m.id] ?? 0) + 1 })}>+</button>
              </div>
            </div>
          ))}
        </div>

        <p className="shares-line" aria-live="polite">
          {preview && !problem
            ? Object.entries(preview).map(([id, c]) => `${nameOf(id)} ${formatCents(c, group.currency)}`).join(" · ")
            : finalProblem && typedCents ? <span className="warn-text">{finalProblem}</span> : " "}
        </p>
      </div>

      <div className="add-bottom">
        <div className="bottom-row">
          <button type="button" className="capsule" disabled={!!existing || groups.length < 2}
            onClick={() => { const i = groups.findIndex((g) => g.id === group.id); setGid(groups[(i + 1) % groups.length].id); }}>
            {group.name}{groups.length > 1 && !existing && <Icon name="down" size={14} />}
          </button>
          <button type="button" className="go" aria-label="Review" disabled={!!finalProblem} onClick={review}>
            <Icon name="arrow" size={24} />
          </button>
        </div>
        {padOpen && <NumberPad value={amount} onChange={setAmount} />}
      </div>
    </div>
  );
}
