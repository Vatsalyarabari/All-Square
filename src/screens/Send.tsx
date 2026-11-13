// Sending someone an invite, a "pick your items" link, or a payback reminder:
// by email (the app sends it), by text (opens your own Messages app, free), or any other app.

import { useState } from "react";
import * as cloud from "../lib/cloud.ts";
import { cleanPhone, looksLikeEmail, looksLikePhone, messageFor, purposeTitle, smsHref, type Purpose } from "../lib/messaging.ts";
import { actions, reload, useAppState, useStore } from "../lib/store.ts";
import type { Group } from "../lib/types.ts";
import { haptic, Icon, Sheet, shareText, useNav, useSheetClose } from "../ui/kit.tsx";

const linkFor = (g: Group, p: Purpose) =>
  !g.inviteCode ? undefined : p.kind === "receipt" ? cloud.receiptLink(g, p.receiptId) : cloud.inviteLink(g.inviteCode);

export function SendSheet({ groupId, memberId, purpose }: { groupId: string; memberId: string; purpose: Purpose }) {
  return <Sheet surface><SendBody groupId={groupId} memberId={memberId} purpose={purpose} /></Sheet>;
}

function SendBody({ groupId, memberId, purpose }: { groupId: string; memberId: string; purpose: Purpose }) {
  const nav = useNav();
  const close = useSheetClose();
  const { mode } = useStore();
  const { groups } = useAppState();
  const g = groups.find((x) => x.id === groupId);
  const m = g?.members.find((x) => x.id === memberId);
  const [email, setEmail] = useState(m?.email ?? "");
  const [phone, setPhone] = useState(m?.phone ?? "");
  const [busy, setBusy] = useState(false);
  if (!g || !m) return null;

  const link = mode === "cloud" ? linkFor(g, purpose) : undefined;
  const me = g.members.find((x) => x.id === g.meId)?.name ?? "me";
  const text = messageFor(purpose, g, m.name, me, link);
  const canEmail = mode === "cloud";

  const saveContact = () => {
    const patch: { email?: string; phone?: string } = {};
    if (email.trim() !== (m.email ?? "") && (email.trim() === "" || looksLikeEmail(email))) patch.email = email.trim();
    if (cleanPhone(phone) !== cleanPhone(m.phone ?? "") && (phone.trim() === "" || looksLikePhone(phone))) patch.phone = cleanPhone(phone);
    if (Object.keys(patch).length) actions.updateMember(g.id, m.id, patch);
  };

  async function sendEmail() {
    if (!looksLikeEmail(email)) return;
    setBusy(true);
    try {
      if (email.trim() !== m!.email) await cloud.updateMember(m!.id, { email: email.trim() });
      await cloud.sendEmail(purpose.kind, g!.id, m!.id, purpose.kind === "receipt" ? { receiptId: purpose.receiptId } : purpose.kind === "reminder" ? { amountCents: purpose.cents } : {});
      haptic(20);
      nav.toast(`Email sent to ${m!.name}`);
      close();
    } catch (e) {
      nav.toast(e instanceof Error ? e.message : "Couldn't send the email");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sheet-body">
      <div className="sheet-top"><button type="button" className="round surface2" aria-label="Close" onClick={close}><Icon name="x" size={20} /></button></div>
      <h2 className="title">{purposeTitle(purpose, m.name)}</h2>
      <p className="message-preview">{text}</p>

      <h3 className="section-title">By text, from your phone</h3>
      <div className="contact-row">
        <input className="field" type="tel" inputMode="tel" autoComplete="off" placeholder="Phone number" aria-label={`${m.name}'s phone number`} value={phone} onChange={(e) => setPhone(e.target.value)} onBlur={saveContact} />
        <a className={`settle-pill ${looksLikePhone(phone) ? "" : "off"}`} aria-disabled={!looksLikePhone(phone)} href={looksLikePhone(phone) ? smsHref(phone, text) : undefined}
          onClick={(e) => { if (!looksLikePhone(phone)) e.preventDefault(); else saveContact(); }}>Text</a>
      </div>

      {canEmail && (
        <>
          <h3 className="section-title">By email, sent by Allsquare</h3>
          <div className="contact-row">
            <input className="field" type="email" inputMode="email" autoComplete="off" placeholder="Email" aria-label={`${m.name}'s email`} value={email} onChange={(e) => setEmail(e.target.value)} />
            <button type="button" className="settle-pill" disabled={busy || !looksLikeEmail(email)} onClick={sendEmail}>{busy ? "…" : "Email"}</button>
          </div>
          <p className="muted small-text">One email of each kind per person per day, so nobody gets spammed.</p>
        </>
      )}

      <button type="button" className="secondary" onClick={() => shareText(text, nav, "Message copied")}>Share another way (WhatsApp, Instagram…)</button>
      {mode === "demo" && <p className="muted small-text pad-s">In the demo there's no real group to join, so links are left out.</p>}
    </div>
  );
}

// ---------- The group's invite link ----------
export function InviteSheet({ groupId }: { groupId: string }) {
  return <Sheet surface><InviteBody groupId={groupId} /></Sheet>;
}

function InviteBody({ groupId }: { groupId: string }) {
  const nav = useNav();
  const close = useSheetClose();
  const { groups } = useAppState();
  const g = groups.find((x) => x.id === groupId);
  const [busy, setBusy] = useState(false);
  if (!g) return null;
  const link = g.inviteCode ? cloud.inviteLink(g.inviteCode) : "";
  const waiting = g.members.filter((m) => !m.userId);
  const me = g.members.find((x) => x.id === g.meId)?.name ?? "me";

  return (
    <div className="sheet-body">
      <div className="sheet-top"><button type="button" className="round surface2" aria-label="Close" onClick={close}><Icon name="x" size={20} /></button></div>
      <h2 className="title">Invite people</h2>
      <p className="muted small-text">Anyone with this link can join {g.name}. They can pick their name from the list or add themselves, no account needed.</p>
      <p className="message-preview link-box">{link || "Saving the group…"}</p>
      <div className="button-row">
        <button type="button" className="secondary" disabled={!link} onClick={() => shareText(messageFor({ kind: "invite" }, g, "there", me, link), nav, "Invite copied")}>Share link</button>
        <button type="button" className="secondary" disabled={!link} onClick={async () => {
          try { await navigator.clipboard.writeText(link); nav.toast("Link copied", "copy"); } catch { nav.toast("Couldn't copy here. Long-press the link instead.", "copy"); }
        }}>Copy</button>
      </div>

      {waiting.length > 0 && (
        <>
          <h3 className="section-title">Haven't joined yet</h3>
          <ul className="plain">
            {waiting.map((m) => (
              <li key={m.id}>
                <span>{m.name}</span>
                <button type="button" className="settle-pill" onClick={() => nav.open(<SendSheet groupId={g.id} memberId={m.id} purpose={{ kind: "invite" }} />)}>Invite</button>
              </li>
            ))}
          </ul>
        </>
      )}

      <button type="button" className="link" disabled={busy} onClick={async () => {
        setBusy(true);
        try { await cloud.resetInvite(g.id); await reload(); nav.toast("New link made. The old one stopped working."); }
        catch (e) { nav.toast(e instanceof Error ? e.message : "Couldn't make a new link"); }
        finally { setBusy(false); }
      }}>Make a new link (the old one stops working)</button>
    </div>
  );
}
