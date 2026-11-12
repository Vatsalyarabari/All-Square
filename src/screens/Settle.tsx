// Record a payment between two people, with a ready-to-send e-Transfer note or reminder.

import { useState } from "react";
import { netBalances } from "../lib/balances.ts";
import { payMessage, reminderMessage } from "../lib/export.ts";
import { centsToInput, formatCents, parseCents, todayISO } from "../lib/money.ts";
import { actions, useAppState } from "../lib/store.ts";
import { Chips, Icon, NumberPad, Sheet, shareText, useNav, useSheetClose } from "../ui/kit.tsx";
import { Review, ReviewRow } from "../ui/Review.tsx";

export function Settle(props: { groupId: string; from?: string; to?: string; cents?: number }) {
  return (
    <Sheet surface className="add-sheet">
      <SettleBody {...props} />
    </Sheet>
  );
}

function SettleBody({ groupId, from: f, to: t, cents }: { groupId: string; from?: string; to?: string; cents?: number }) {
  const { groups } = useAppState();
  const nav = useNav();
  const close = useSheetClose();
  const group = groups.find((g) => g.id === groupId)!;
  const ids = group.members.map((m) => m.id);
  const [from, setFrom] = useState(f ?? (ids.find((id) => id !== group.meId) ?? ids[0]));
  const [to, setTo] = useState(t ?? group.meId);
  const [amount, setAmount] = useState(cents ? centsToInput(cents) : "");
  const nameOf = (id: string) => group.members.find((m) => m.id === id)?.name ?? "?";
  const people = group.members.map((m) => ({ id: m.id, label: m.id === group.meId ? `${m.name} (you)` : m.name }));
  const value = parseCents(amount) ?? 0;
  const problem = from === to ? "Pick two different people" : !value ? "Enter the amount paid" : null;

  function review() {
    if (problem) return;
    const net = netBalances(group);
    const after = net[from] + value;
    nav.open(
      <Review title="Settle up" verb="settle" toastText="Payment recorded"
        note={after === 0 ? `${nameOf(from)} will be all square.` : `Balances in ${group.name} update for everyone.`}
        onConfirm={() => actions.addSettlement(group.id, { from, to, cents: value, date: todayISO() })}>
        <ReviewRow label="From" value={nameOf(from)} />
        <ReviewRow label="To" value={nameOf(to)} />
        <ReviewRow label="Amount" value={<b className="serif">{formatCents(value, group.currency)}</b>} />
      </Review>,
    );
  }

  const me = group.meId;
  const myName = nameOf(me);
  return (
    <div className="add">
      <div className="add-scroll">
        <div className="sheet-top">
          <button type="button" className="round surface2" aria-label="Close" onClick={close}><Icon name="x" size={20} /></button>
        </div>
        <h2 className="title">Settle up</h2>
        <p className="muted small-text">Record money that changed hands outside the app, like an e-Transfer or cash.</p>
        <div className="row stack"><span className="row-label">Who paid</span><Chips options={people} selected={[from]} onToggle={setFrom} /></div>
        <div className="row stack"><span className="row-label">Who received it</span><Chips options={people} selected={[to]} onToggle={setTo} /></div>
        <div className="row amount-row active">
          <span className="row-label">Amount</span>
          <span className="amount-value serif">${amount || "0"}<span className="caret" /></span>
        </div>
        {value > 0 && from === me && to !== me && (
          <button type="button" className="helper" onClick={() => shareText(payMessage(group, nameOf(to), value), nav, "e-Transfer note copied")}>
            <Icon name="copy" size={16} /> Copy an e-Transfer note for {nameOf(to)}
          </button>
        )}
        {value > 0 && to === me && from !== me && (
          <button type="button" className="helper" onClick={() => shareText(reminderMessage(group, nameOf(from), value, myName), nav, "Reminder copied")}>
            <Icon name="send" size={16} /> Send {nameOf(from)} a friendly reminder
          </button>
        )}
      </div>
      <div className="add-bottom">
        <div className="bottom-row">
          <span className="capsule">{group.name}</span>
          <button type="button" className="go" aria-label="Review" disabled={!!problem} onClick={review}><Icon name="arrow" size={24} /></button>
        </div>
        <NumberPad value={amount} onChange={setAmount} />
      </div>
    </div>
  );
}
