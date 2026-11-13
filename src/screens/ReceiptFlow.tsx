// Scan a receipt → check the lines → tap who had what → swipe up to add.

import { useMemo, useState } from "react";
import { guessCategory } from "../lib/categories.ts";
import { suggest } from "../lib/itemMemory.ts";
import { centsToInput, formatCents, parseCents, todayISO } from "../lib/money.ts";
import { scanAvailable, scanPhoto } from "../lib/scanner.ts";
import { receiptLink } from "../lib/cloud.ts";
import { claimableItems, reconcile, splitReceipt, type Claims, type Receipt, type SplitResult } from "../lib/split.ts";
import { actions, useAppState, useStore } from "../lib/store.ts";
import type { Group } from "../lib/types.ts";
import { SendSheet } from "./Send.tsx";
import samples from "../data/sample-receipts.json";
import { Chips, ConfirmButton, haptic, Icon, Sheet, shareText, useNav, useSheetClose } from "../ui/kit.tsx";
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
  const [how, setHow] = useState<"me" | null>(null);
  const [sharedId, setSharedId] = useState<string | null>(null);
  const { mode } = useStore();
  if (!group) return null;
  if (sharedId) return <SessionBody groupId={group.id} receiptId={sharedId} />;
  if (frozen && draft && (mode !== "cloud" || how === "me")) return <ClaimStep group={group} receipt={frozen} date={draft.date} onBack={() => (mode === "cloud" ? setHow(null) : setFrozen(null))} />;
  if (frozen && draft) return <HowStep group={group} receipt={frozen} date={draft.date} onBack={() => setFrozen(null)} onMe={() => setHow("me")} onShared={setSharedId} />;
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

// ---------- Shared pieces for tapping who had what ----------
type Unit = ReturnType<typeof claimableItems>[number];

function ClaimList({ group, units, claims, result, onToggle, remembered }: {
  group: Group; units: Unit[]; claims: Claims; result: SplitResult; onToggle: (unit: string, person: string) => void; remembered?: Set<string>;
}) {
  // You first, so tapping your own items is quickest.
  const people = [...group.members].sort((a, b) => (a.id === group.meId ? -1 : b.id === group.meId ? 1 : 0));
  return (
    <ul className="claim-list">
      {units.map((u) => {
        const who = claims[u.id] ?? [];
        return (
          <li key={u.id} className={who.length ? "" : "unclaimed"}>
            <div className="claim-head">
              <span className="grow"><span className="arow-title">{u.name}</span>
                {remembered?.has(u.id) && <span className="kicker">remembered</span>}
              </span>
              <span className="amt">{formatCents(result.itemGross[u.id] ?? u.cents, group.currency)}</span>
            </div>
            <div className="claim-people">
              {people.map((m) => (
                <button type="button" key={m.id} className={`pchip ${who.includes(m.id) ? "on" : ""} ${m.id === group.meId ? "me" : ""}`} aria-pressed={who.includes(m.id)}
                  aria-label={`${m.id === group.meId ? "I" : m.name} had ${u.name}`} onClick={() => { haptic(5); onToggle(u.id, m.id); }}>
                  {m.id === group.meId ? "Me" : m.name}
                </button>
              ))}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function buildExpense(receipt: Receipt, date: string, payer: string, tipCents: number, units: Unit[], claims: Claims, result: SplitResult) {
  const total = receipt.totalCents + tipCents;
  const lines = units.map((u) => ({ name: u.name, cents: result.itemGross[u.id], who: claims[u.id] ?? [] }));
  const guessed = guessCategory(receipt.store);
  const expense = {
    description: receipt.store, date, totalCents: total, payers: { [payer]: total },
    split: { kind: "exact" as const, shares: result.perPerson }, category: guessed === "Other" ? ("Groceries" as const) : guessed,
    itemized: { store: receipt.store, lines, taxCents: receipt.taxLines.reduce((a, t) => a + t.cents, 0), tipCents },
  };
  return { expense, lines, total };
}

function ReviewSplit({ group, receipt, payer, tipCents, result, total, lines, onConfirm }: {
  group: Group; receipt: Receipt; payer: string; tipCents: number; result: SplitResult; total: number; lines: unknown[]; onConfirm: () => void;
}) {
  const nameOf = (id: string) => group.members.find((m) => m.id === id)?.name ?? "?";
  return (
    <Review title={receipt.store} verb="add" toastText="Receipt split and added"
      note={`${lines.length} items. Next time, Allsquare will suggest who takes each of these.`} onConfirm={onConfirm}>
      <ReviewRow label="Paid by" value={nameOf(payer)} />
      <ReviewRow label="Total" value={<b className="serif">{formatCents(total, group.currency)}</b>} />
      {tipCents > 0 && <ReviewRow indent label="includes tip" value={formatCents(tipCents, group.currency)} />}
      {Object.entries(result.perPerson).map(([id, c]) => <ReviewRow key={id} indent label={nameOf(id)} value={formatCents(c, group.currency)} />)}
    </Review>
  );
}

const sharesLine = (group: Group, result: SplitResult) =>
  Object.entries(result.perPerson).map(([id, c]) => `${id === group.meId ? "You" : group.members.find((m) => m.id === id)?.name ?? "?"} ${formatCents(c, group.currency)}`).join(" · ");

// ---------- 3a. Everyone on their own phone, or you tap for them ----------
function HowStep({ group, receipt, date, onBack, onMe, onShared }: { group: Group; receipt: Receipt; date: string; onBack: () => void; onMe: () => void; onShared: (id: string) => void }) {
  const nav = useNav();
  const [busy, setBusy] = useState(false);
  async function share() {
    setBusy(true);
    try {
      onShared(await actions.shareReceipt(group.id, receipt, date, group.meId));
    } catch (e) {
      nav.toast(e instanceof Error ? e.message : "Couldn't share the receipt");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="sheet-body">
      <div className="sheet-top">
        <button type="button" className="round surface2" aria-label="Back" onClick={onBack}><Icon name="back" size={20} /></button>
        <span className="kicker">Step 2 of 2</span>
      </div>
      <h2 className="title">Who taps the items?</h2>
      <button type="button" className="source" disabled={busy} onClick={share}>
        <span className="source-icon"><Icon name="people" size={24} /></span>
        <span className="grow"><b>{busy ? "Sharing…" : "Everyone picks their own"}</b>
          <small className="muted">Send a link. Each person taps what they had on their phone, and you see it live.</small></span>
      </button>
      <button type="button" className="source" onClick={onMe}>
        <span className="source-icon"><Icon name="scan" size={24} /></span>
        <span className="grow"><b>I'll tap for everyone</b><small className="muted">Quicker when you're all at the same table.</small></span>
      </button>
    </div>
  );
}

// ---------- 3b. You tap who had each item ----------
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
  const toggle = (unit: string, person: string) => {
    const cur = claims[unit] ?? [];
    setClaims({ ...claims, [unit]: cur.includes(person) ? cur.filter((x) => x !== person) : [...cur, person] });
  };
  const total = receipt.totalCents + tipCents;

  function review() {
    if (result.unclaimedCents) return;
    const { expense, lines } = buildExpense(receipt, date, payer, tipCents, units, claims, result);
    nav.open(<ReviewSplit group={group} receipt={receipt} payer={payer} tipCents={tipCents} result={result} total={total} lines={lines}
      onConfirm={() => { actions.saveExpense(group.id, expense); actions.rememberItems(group.id, lines); }} />);
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

        <ClaimList group={group} units={units} claims={claims} result={result} onToggle={toggle} remembered={remembered} />
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
          {sharesLine(group, result) || "Nobody has claimed anything yet"}
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

// ---------- 4. A shared receipt: everyone taps on their own phone, live ----------
export function ReceiptSession({ groupId, receiptId }: { groupId: string; receiptId: string }) {
  return (
    <Sheet surface className="add-sheet">
      <SessionBody groupId={groupId} receiptId={receiptId} />
    </Sheet>
  );
}

function SessionBody({ groupId, receiptId }: { groupId: string; receiptId: string }) {
  const nav = useNav();
  const close = useSheetClose();
  const { groups } = useAppState();
  const { account } = useStore();
  const group = groups.find((g) => g.id === groupId);
  const r = group?.receipts?.find((x) => x.id === receiptId);
  const units = useMemo(() => (r ? claimableItems(r.receipt) : []), [r]);
  const [tip, setTip] = useState(r?.tipCents ? centsToInput(r.tipCents) : "");

  const shut = <div className="sheet-top"><button type="button" className="round surface2" aria-label="Close" onClick={close}><Icon name="x" size={20} /></button></div>;
  if (!group) return <div className="sheet-body">{shut}<p className="muted">This group isn't available.</p></div>;
  if (!r) {
    return (
      <div className="sheet-body">{shut}
        <h2 className="title">This receipt is done</h2>
        <p className="muted">It's already been added as an expense (or was cancelled). Check the group's activity.</p>
      </div>
    );
  }

  const claims: Claims = {};
  for (const c of r.claims) (claims[c.unitId] ??= []).push(c.memberId);
  const result = splitReceipt(r.receipt, claims, r.tipCents);
  const isOwner = r.createdBy === account?.userId;
  const total = r.receipt.totalCents + r.tipCents;
  const nameOf = (id: string) => group.members.find((m) => m.id === id)?.name ?? "?";
  const notYet = group.members.filter((m) => m.id !== group.meId && !r.claims.some((c) => c.memberId === m.id));
  const me = nameOf(group.meId);
  const owner = group.members.find((m) => m.userId === r.createdBy)?.name ?? "Whoever scanned it";
  const link = group.inviteCode ? receiptLink(group, r.id) : "";

  function finish() {
    if (!r || !group || result.unclaimedCents) return;
    const { expense, lines } = buildExpense(r.receipt, r.date, r.payerId, r.tipCents, units, claims, result);
    nav.open(<ReviewSplit group={group} receipt={r.receipt} payer={r.payerId} tipCents={r.tipCents} result={result} total={total} lines={lines}
      onConfirm={() => void actions.finishReceipt(group.id, r.id, expense, lines).catch((e) => nav.toast(e instanceof Error ? e.message : "Couldn't add it"))} />);
  }

  return (
    <div className="add">
      <div className="add-scroll">
        {shut}
        <span className="kicker live-dot">Live · taps show up on everyone's phone</span>
        <h2 className="title">{r.receipt.store}</h2>
        <p className="muted small-text">Tap <b>Me</b> on everything you had. Shared something? Tap everyone who shared it. Prices include tax.</p>

        {notYet.length > 0 && (
          <div className="row stack">
            <span className="row-label">Haven't picked yet</span>
            <div className="chips">
              {notYet.map((m) => (
                <button type="button" key={m.id} className="chip small" onClick={() => nav.open(<SendSheet groupId={group.id} memberId={m.id} purpose={{ kind: "receipt", receiptId: r.id, store: r.receipt.store }} />)}>
                  {m.name} <Icon name="send" size={14} />
                </button>
              ))}
              {link && (
                <button type="button" className="chip small" onClick={() => shareText(`I scanned the ${r.receipt.store} receipt for "${group.name}". Tap what you had: ${link}`, nav, "Link copied")}>
                  Send to the group chat
                </button>
              )}
            </div>
          </div>
        )}

        <div className="row stack"><span className="row-label">Paid by</span>
          {isOwner
            ? <Chips small options={group.members.map((m) => ({ id: m.id, label: m.id === group.meId ? `${m.name} (you)` : m.name }))} selected={[r.payerId]} onToggle={(id) => actions.updateReceipt(group.id, r, { payerId: id })} />
            : <span>{r.payerId === group.meId ? `${me} (you)` : nameOf(r.payerId)}</span>}
        </div>

        <ClaimList group={group} units={units} claims={claims} result={result} onToggle={(u, p) => actions.toggleClaim(group.id, r.id, u, p)} />

        {isOwner ? (
          <>
            {result.unclaimedItems.length > 0 && (
              <button type="button" className="secondary" onClick={() => result.unclaimedItems.forEach((u) => group.members.forEach((m) => actions.toggleClaim(group.id, r.id, u, m.id)))}>
                Split the {result.unclaimedItems.length} unclaimed item{result.unclaimedItems.length > 1 ? "s" : ""} between everyone
              </button>
            )}
            <label className="row rate-row">
              <span className="row-label">Tip <small className="muted">(split by what each had)</small></span>
              <input inputMode="decimal" value={tip} onChange={(e) => setTip(e.target.value)} placeholder="0.00" aria-label="Tip"
                onBlur={() => { const c = parseCents(tip) ?? 0; if (c !== r.tipCents) actions.updateReceipt(group.id, r, { tipCents: c }); }} />
            </label>
            <ConfirmButton className="danger-btn" label="Cancel this receipt" confirmLabel="Tap again to throw away this receipt"
              onConfirm={() => { actions.cancelReceipt(group.id, r.id); close(); nav.toast("Receipt cancelled"); }} />
          </>
        ) : r.tipCents > 0 && <p className="muted small-text pad-s">Includes a {formatCents(r.tipCents, group.currency)} tip, split by what each person had.</p>}
      </div>
      <div className="add-bottom">
        <p className="shares-line">
          {sharesLine(group, result) || "Nobody has claimed anything yet"}
          {result.unclaimedCents > 0 && <span className="warn-text"> · {formatCents(result.unclaimedCents, group.currency)} unclaimed</span>}
        </p>
        {isOwner ? (
          <div className="bottom-row">
            <span className="capsule">{formatCents(total, group.currency)}</span>
            <button type="button" className="go" aria-label="Review and add" disabled={result.unclaimedCents > 0} onClick={finish}><Icon name="arrow" size={24} /></button>
          </div>
        ) : (
          <button type="button" className="primary" onClick={() => { close(); nav.toast(`Saved. ${owner} adds it once everyone's picked.`); }}>
            Done · my share {formatCents(result.perPerson[group.meId] ?? 0, group.currency)}
          </button>
        )}
      </div>
    </div>
  );
}

