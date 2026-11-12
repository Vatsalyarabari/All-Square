// Scan a receipt → check the lines → tap who had what → swipe up to add.

import { useMemo, useState } from "react";
import { guessCategory } from "../lib/categories.ts";
import { suggest } from "../lib/itemMemory.ts";
import { centsToInput, formatCents, parseCents, todayISO } from "../lib/money.ts";
import { scanAvailable, scanPhoto } from "../lib/scanner.ts";
import { claimableItems, reconcile, splitReceipt, type Claims, type Receipt } from "../lib/split.ts";
import { actions, useAppState } from "../lib/store.ts";
import type { Group } from "../lib/types.ts";
import samples from "../data/sample-receipts.json";
import { Chips, haptic, Icon, Sheet, useNav, useSheetClose } from "../ui/kit.tsx";
import { Review, ReviewRow } from "../ui/Review.tsx";

type Line = { id: string; name: string; price: string; taxes: string[]; discountOf?: string; qty?: number };
type Draft = {
  store: string;
  date: string;
  lines: Line[];
  taxes: { code: string; amount: string }[];
  total: string;
  marked: boolean; // the receipt shows which items were taxed
};

let lineSeq = 0;
const toDraft = (r: Receipt, date?: string): Draft => ({
  store: r.store,
  date: date ?? todayISO(),
  lines: r.items.map((i) => ({ id: i.id, name: i.name, price: (i.cents < 0 ? "-" : "") + centsToInput(Math.abs(i.cents)), taxes: i.taxes ?? [], discountOf: i.discountOf, qty: i.qty })),
  taxes: r.taxLines.filter((t) => t.cents).map((t) => ({ code: t.code, amount: centsToInput(t.cents) })),
  total: centsToInput(r.totalCents),
  marked: r.taxMarking === "per-item",
});

const signed = (s: string) => {
  const neg = s.trim().startsWith("-");
  const c = parseCents(s.replace("-", ""));
  return c === null ? null : neg ? -c : c;
};

function toReceipt(d: Draft): { receipt: Receipt; bad: string[] } {
  const bad: string[] = [];
  const receipt: Receipt = {
    id: "draft",
    store: d.store.trim() || "Receipt",
    items: d.lines.map((l) => {
      const c = signed(l.price);
      if (c === null) bad.push(`"${l.name || "A line"}" has a price that isn't a number`);
      return { id: l.id, name: l.name.trim() || "Item", cents: c ?? 0, taxes: l.taxes, discountOf: l.discountOf, qty: l.qty };
    }),
    taxLines: d.taxes.map((t) => ({ code: t.code.trim().toUpperCase() || "TAX", cents: parseCents(t.amount) ?? 0 })).filter((t) => t.cents > 0),
    totalCents: parseCents(d.total) ?? 0,
    taxMarking: d.marked ? "per-item" : "none",
  };
  return { receipt, bad };
}

export function ReceiptFlow({ groupId }: { groupId: string }) {
  return (
    <Sheet surface className="add-sheet">
      <Body groupId={groupId} />
    </Sheet>
  );
}

function Body({ groupId }: { groupId: string }) {
  const { groups } = useAppState();
  const group = groups.find((g) => g.id === groupId);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [frozen, setFrozen] = useState<Receipt | null>(null);
  if (!group) return null;
  if (frozen && draft) return <ClaimStep group={group} receipt={frozen} date={draft.date} onBack={() => setFrozen(null)} />;
  if (draft) return <EditStep draft={draft} setDraft={setDraft} onBack={() => setDraft(null)} onNext={setFrozen} />;
  return <SourceStep onReady={setDraft} />;
}

// ---------- 1. Where the receipt comes from ----------
function SourceStep({ onReady }: { onReady: (d: Draft) => void }) {
  const close = useSheetClose();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showSamples, setShowSamples] = useState(false);

  async function scan(file?: File) {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const { receipt, date } = await scanPhoto(file);
      haptic(20);
      onReady(toDraft(receipt, date));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sheet-body">
      <div className="sheet-top"><button type="button" className="round surface2" aria-label="Close" onClick={close}><Icon name="x" size={20} /></button></div>
      <h2 className="title">Split a receipt</h2>
      <p className="muted small-text">Each line becomes something people tap to claim. Tax only lands on items that were taxed.</p>

      <label className={`source ${!scanAvailable || busy ? "disabled" : ""}`}>
        <span className="source-icon"><Icon name="camera" size={24} /></span>
        <span className="grow">
          <b>{busy ? "Reading the receipt…" : "Scan a photo"}</b>
          <small className="muted">{scanAvailable ? "Flat, well-lit, whole receipt in frame." : "Turns on once the scan server is set up (Stage 3)."}</small>
        </span>
        <input type="file" accept="image/*" capture="environment" disabled={!scanAvailable || busy} onChange={(e) => scan(e.target.files?.[0])} />
      </label>
      {error && <p className="warn-text pad-s">{error}</p>}

      <button type="button" className="source" onClick={() => onReady({ store: "", date: todayISO(), lines: [{ id: `n${++lineSeq}`, name: "", price: "", taxes: [] }], taxes: [], total: "", marked: true })}>
        <span className="source-icon"><Icon name="activity" size={24} /></span>
        <span className="grow"><b>Type the items in</b><small className="muted">For short receipts or when scanning isn't available.</small></span>
      </button>

      <button type="button" className="source" aria-expanded={showSamples} onClick={() => setShowSamples(!showSamples)}>
        <span className="source-icon"><Icon name="scan" size={24} /></span>
        <span className="grow"><b>Try a sample receipt</b><small className="muted">Your 7 test receipts, already read.</small></span>
      </button>
      {showSamples && (
        <ul className="plain">
          {(samples as unknown as (Receipt & { date: string })[]).map((r) => (
            <li key={r.id}>
              <button type="button" className="sample-row" onClick={() => onReady(toDraft(r, r.date))}>
                <span>{r.store}</span><span className="muted">{formatCents(r.totalCents)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------- 2. Check and fix the lines ----------
function EditStep({ draft, setDraft, onBack, onNext }: { draft: Draft; setDraft: (d: Draft) => void; onBack: () => void; onNext: (r: Receipt) => void }) {
  const { receipt, bad } = toReceipt(draft);
  const issues = bad.length ? [] : reconcile(receipt);
  const errors = [...bad, ...issues.filter((i) => i.level === "error").map((i) => i.message)];
  const notices = issues.filter((i) => i.level === "notice").map((i) => i.message);
  const itemsPlusTax = receipt.items.reduce((a, i) => a + i.cents, 0) + receipt.taxLines.reduce((a, t) => a + t.cents, 0);
  const codes = [...new Set(receipt.taxLines.map((t) => t.code))];
  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });
  const setLine = (id: string, patch: Partial<Line>) => set({ lines: draft.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)) });

  return (
    <div className="add">
      <div className="add-scroll">
        <div className="sheet-top">
          <button type="button" className="round surface2" aria-label="Back" onClick={onBack}><Icon name="back" size={20} /></button>
          <span className="kicker">Step 1 of 2</span>
        </div>
        <h2 className="title">Check the receipt</h2>
        <input className="desc" value={draft.store} onChange={(e) => set({ store: e.target.value })} placeholder="Store name" aria-label="Store name" />

        {errors.length > 0 && (
          <div className="issue error">
            {errors.map((m) => <p key={m}>{m}</p>)}
            {errors.some((m) => m.includes("receipt total is")) && itemsPlusTax > 0 && (
              <button type="button" className="link" onClick={() => set({ total: centsToInput(itemsPlusTax) })}>
                If the total itself was misread, use {formatCents(itemsPlusTax)}
              </button>
            )}
          </div>
        )}
        {errors.length === 0 && receipt.items.length > 0 && <div className="issue ok"><p>✓ Lines and tax add up to the receipt total.</p></div>}
        {notices.map((m) => <div className="issue" key={m}><p>{m}</p></div>)}

        <h3 className="section-title">Items</h3>
        {draft.lines.map((l) => (
          <div className="rline" key={l.id}>
            <div className="rline-main">
              <input value={l.name} placeholder="Item" aria-label="Item name" onChange={(e) => setLine(l.id, { name: e.target.value })} />
              <input className="rline-price" inputMode="decimal" value={l.price} placeholder="0.00" aria-label={`Price of ${l.name || "item"}`} onChange={(e) => setLine(l.id, { price: e.target.value })} />
              <button type="button" className="mini-x" aria-label={`Remove ${l.name || "line"}`} onClick={() => set({ lines: draft.lines.filter((x) => x.id !== l.id) })}>×</button>
            </div>
            {(draft.marked && codes.length > 0 || l.price.trim().startsWith("-")) && (
              <div className="rline-sub">
                {draft.marked && codes.map((c) => (
                  <button type="button" key={c} className={`chip small ${l.taxes.includes(c) ? "on" : ""}`} aria-pressed={l.taxes.includes(c)}
                    onClick={() => setLine(l.id, { taxes: l.taxes.includes(c) ? l.taxes.filter((x) => x !== c) : [...l.taxes, c] })}>{c}</button>
                ))}
                {l.price.trim().startsWith("-") && (
                  <label className="chip small select-chip">
                    Discount on: {draft.lines.find((x) => x.id === l.discountOf)?.name || "pick an item"}
                    <select value={l.discountOf ?? ""} onChange={(e) => setLine(l.id, { discountOf: e.target.value || undefined })} aria-label="Which item this discount is for">
                      <option value="">Pick an item</option>
                      {draft.lines.filter((x) => x.id !== l.id && !x.price.trim().startsWith("-")).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                    </select>
                  </label>
                )}
              </div>
            )}
          </div>
        ))}
        <button type="button" className="link" onClick={() => set({ lines: [...draft.lines, { id: `n${++lineSeq}`, name: "", price: "", taxes: [] }] })}>+ Add a line</button>

        <h3 className="section-title">Tax</h3>
        {draft.taxes.map((t, i) => (
          <div className="rline-main" key={i}>
            <input value={t.code} aria-label="Tax name" placeholder="GST" onChange={(e) => set({ taxes: draft.taxes.map((x, j) => (j === i ? { ...x, code: e.target.value } : x)) })} />
            <input className="rline-price" inputMode="decimal" value={t.amount} placeholder="0.00" aria-label="Tax amount" onChange={(e) => set({ taxes: draft.taxes.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)) })} />
            <button type="button" className="mini-x" aria-label="Remove tax" onClick={() => set({ taxes: draft.taxes.filter((_, j) => j !== i) })}>×</button>
          </div>
        ))}
        <button type="button" className="link" onClick={() => set({ taxes: [...draft.taxes, { code: draft.taxes.length ? "PST" : "GST", amount: "" }] })}>+ Add a tax line</button>
        {draft.taxes.length > 0 && (
          <label className="toggle-row">
            <input type="checkbox" checked={draft.marked} onChange={(e) => set({ marked: e.target.checked })} />
            The receipt marks which items were taxed
          </label>
        )}

        <div className="row amount-row">
          <span className="row-label">Receipt total</span>
          <input className="total-input serif" inputMode="decimal" value={draft.total} onChange={(e) => set({ total: e.target.value })} aria-label="Receipt total" />
        </div>
      </div>
      <div className="add-bottom">
        <button type="button" className="primary" disabled={errors.length > 0 || receipt.items.length === 0} onClick={() => onNext(receipt)}>
          {errors.length ? "Fix the lines above to continue" : "Next: who had what"}
        </button>
      </div>
    </div>
  );
}

// ---------- 3. Tap who had each item ----------
function ClaimStep({ group, receipt, date, onBack }: { group: Group; receipt: Receipt; date: string; onBack: () => void }) {
  const nav = useNav();
  const ids = group.members.map((m) => m.id);
  const units = useMemo(() => claimableItems(receipt), [receipt]);
  const [claims, setClaims] = useState<Claims>(() => Object.fromEntries(units.map((u) => [u.id, suggest(group.itemMemory, u.name, ids)])));
  const [remembered] = useState(() => new Set(units.filter((u) => suggest(group.itemMemory, u.name, ids).length).map((u) => u.id)));
  const [payer, setPayer] = useState(group.meId);
  const [tip, setTip] = useState("");
  const tipCents = parseCents(tip) ?? 0;
  const result = splitReceipt(receipt, claims, tipCents);
  const nameOf = (id: string) => group.members.find((m) => m.id === id)?.name ?? "?";
  const toggle = (unit: string, person: string) => {
    haptic(5);
    const cur = claims[unit] ?? [];
    setClaims({ ...claims, [unit]: cur.includes(person) ? cur.filter((x) => x !== person) : [...cur, person] });
  };
  const total = receipt.totalCents + tipCents;

  function review() {
    if (result.unclaimedCents) return;
    const lines = units.map((u) => ({ name: u.name, cents: result.itemGross[u.id], who: claims[u.id] ?? [] }));
    const guessed = guessCategory(receipt.store);
    const expense = {
      description: receipt.store, date, totalCents: total, payers: { [payer]: total },
      split: { kind: "exact" as const, shares: result.perPerson }, category: guessed === "Other" ? ("Groceries" as const) : guessed,
      itemized: { store: receipt.store, lines, taxCents: receipt.taxLines.reduce((a, t) => a + t.cents, 0), tipCents },
    };
    nav.open(
      <Review title={receipt.store} verb="add" toastText="Receipt split and added"
        note={`${lines.length} items. Next time, Allsquare will suggest who takes each of these.`}
        onConfirm={() => { actions.saveExpense(group.id, expense); actions.rememberItems(group.id, lines); }}>
        <ReviewRow label="Paid by" value={nameOf(payer)} />
        <ReviewRow label="Total" value={<b className="serif">{formatCents(total, group.currency)}</b>} />
        {tipCents > 0 && <ReviewRow indent label="includes tip" value={formatCents(tipCents, group.currency)} />}
        {Object.entries(result.perPerson).map(([id, c]) => <ReviewRow key={id} indent label={nameOf(id)} value={formatCents(c, group.currency)} />)}
      </Review>,
    );
  }

  return (
    <div className="add">
      <div className="add-scroll">
        <div className="sheet-top">
          <button type="button" className="round surface2" aria-label="Back" onClick={onBack}><Icon name="back" size={20} /></button>
          <span className="kicker">Step 2 of 2</span>
        </div>
        <h2 className="title">Who had what?</h2>
        <p className="muted small-text">Tap everyone who shared an item. Prices include that item's tax.</p>

        <div className="row stack"><span className="row-label">Paid by</span>
          <Chips small options={group.members.map((m) => ({ id: m.id, label: m.id === group.meId ? `${m.name} (you)` : m.name }))} selected={[payer]} onToggle={setPayer} />
        </div>

        <ul className="claim-list">
          {units.map((u) => {
            const who = claims[u.id] ?? [];
            return (
              <li key={u.id} className={who.length ? "" : "unclaimed"}>
                <div className="claim-head">
                  <span className="grow"><span className="arow-title">{u.name}</span>
                    {remembered.has(u.id) && <span className="kicker">remembered</span>}
                  </span>
                  <span className="amt">{formatCents(result.itemGross[u.id] ?? u.cents, group.currency)}</span>
                </div>
                <div className="claim-people">
                  {group.members.map((m) => (
                    <button type="button" key={m.id} className={`pchip ${who.includes(m.id) ? "on" : ""}`} aria-pressed={who.includes(m.id)} aria-label={`${m.name} had ${u.name}`} onClick={() => toggle(u.id, m.id)}>
                      {m.name}
                    </button>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
        {result.unclaimedItems.length > 0 && (
          <button type="button" className="secondary" onClick={() => setClaims({ ...claims, ...Object.fromEntries(result.unclaimedItems.map((id) => [id, ids])) })}>
            Split the {result.unclaimedItems.length} unclaimed item{result.unclaimedItems.length > 1 ? "s" : ""} between everyone
          </button>
        )}
        <label className="row rate-row">
          <span className="row-label">Tip <small className="muted">(split by what each had)</small></span>
          <input inputMode="decimal" value={tip} onChange={(e) => setTip(e.target.value)} placeholder="0.00" aria-label="Tip" />
          
        </label>
      </div>
      <div className="add-bottom">
        <p className="shares-line">
          {Object.entries(result.perPerson).map(([id, c]) => `${nameOf(id)} ${formatCents(c, group.currency)}`).join(" · ") || "Nobody has claimed anything yet"}
          {result.unclaimedCents > 0 && <span className="warn-text"> · {formatCents(result.unclaimedCents, group.currency)} unclaimed</span>}
        </p>
        <div className="bottom-row">
          <span className="capsule">{formatCents(total, group.currency)}</span>
          <button type="button" className="go" aria-label="Review" disabled={result.unclaimedCents > 0} onClick={review}><Icon name="arrow" size={24} /></button>
        </div>
      </div>
    </div>
  );
}
