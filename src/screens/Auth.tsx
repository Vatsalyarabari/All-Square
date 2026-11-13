// Signing in, joining a group from an invite link, and the account sheet.

import { useEffect, useState } from "react";
import * as cloud from "../lib/cloud.ts";
import { looksLikeEmail } from "../lib/messaging.ts";
import { enterDemo, exitDemo, forgetPhoneGroups, isSampleGroup, moveFromPhone, phoneGroups, reload, useStore } from "../lib/store.ts";
import { ConfirmButton, haptic, Icon, Sheet, useNav, useSheetClose } from "../ui/kit.tsx";
import { GroupSheet } from "./GroupSheet.tsx";
import { ReceiptSession } from "./ReceiptFlow.tsx";

const errText = (e: unknown) => (e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : "Something went wrong");

// ---------- Sign-in page (cloud builds, when nobody is signed in) ----------
export function SignIn({ invited }: { invited: boolean }) {
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="signin">
      <span className="wordmark big-mark">Allsquare</span>
      <p className="serif signin-lede">{invited ? "You've been invited to split costs." : "Split bills with friends, free."}</p>
      <p className="muted small-text">{invited ? "Sign in, or continue as a guest, to see the group." : "Sign in so your groups follow you to every phone and everyone sees the same numbers."}</p>

      {!sentTo ? (
        <>
          <button type="button" className="primary google" disabled={busy} onClick={() => run(cloud.signInWithGoogle)}>
            <span className="g-mark" aria-hidden>G</span> Continue with Google
          </button>
          <div className="or"><span>or</span></div>
          <form onSubmit={(e) => { e.preventDefault(); if (looksLikeEmail(email)) void run(async () => { await cloud.sendEmailLink(email.trim()); setSentTo(email.trim()); }); }}>
            <input className="field" type="email" inputMode="email" autoComplete="email" placeholder="you@example.com" aria-label="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <button type="submit" className="secondary" disabled={busy || !looksLikeEmail(email)}>Email me a sign-in link</button>
          </form>
          {invited && (
            <button type="button" className="link center" disabled={busy} onClick={() => run(cloud.signInAsGuest)}>
              Continue as a guest
            </button>
          )}
        </>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); void run(() => cloud.verifyEmailCode(sentTo, code)); }}>
          <div className="issue ok"><p>Check {sentTo}. Tap the link in the email, or type the 6-digit code here (handy if Allsquare is on your home screen).</p></div>
          <input className="field code" inputMode="numeric" autoComplete="one-time-code" maxLength={8} placeholder="123456" aria-label="Code from the email" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
          <button type="submit" className="primary" disabled={busy || code.length < 6}>Sign in</button>
          <button type="button" className="link center" onClick={() => { setSentTo(""); setCode(""); }}>Use a different email</button>
        </form>
      )}
      {error && <p className="warn-text pad-s" role="alert">{error}</p>}

      <button type="button" className="link center demo-link" onClick={() => { haptic(); enterDemo(); }}>Just looking? Try the demo</button>
    </div>
  );
}

// ---------- Join a group from ?join=CODE ----------
export function JoinSheet({ code, receiptId, onDone }: { code: string; receiptId?: string; onDone: () => void }) {
  return <Sheet surface><JoinBody code={code} receiptId={receiptId} onDone={onDone} /></Sheet>;
}

function JoinBody({ code, receiptId, onDone }: { code: string; receiptId?: string; onDone: () => void }) {
  const nav = useNav();
  const close = useSheetClose();
  const { account } = useStore();
  const [preview, setPreview] = useState<cloud.InvitePreview | null | "loading">("loading");
  const [pick, setPick] = useState<string | "new" | null>(null);
  const [name, setName] = useState(account?.name ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const openTarget = (groupId: string) => {
    onDone();
    nav.closeAll();
    nav.open(<GroupSheet groupId={groupId} />);
    if (receiptId) nav.open(<ReceiptSession groupId={groupId} receiptId={receiptId} />);
  };

  useEffect(() => {
    cloud.invitePreview(code).then(
      async (p) => {
        if (p?.already_member) {
          await reload();
          openTarget(p.group_id);
        } else setPreview(p);
      },
      (e) => { setError(errText(e)); setPreview(null); },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  async function join() {
    setBusy(true);
    setError("");
    try {
      const gid = await cloud.joinGroup(code, pick === "new" ? null : pick, pick === "new" ? name.trim() : null);
      await reload();
      haptic(20);
      nav.toast("You're in");
      openTarget(gid);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  const top = <div className="sheet-top"><button type="button" className="round surface2" aria-label="Close" onClick={() => { onDone(); close(); }}><Icon name="x" size={20} /></button></div>;
  if (preview === "loading") return <div className="sheet-body">{top}<p className="muted">Opening the invite…</p></div>;
  if (!preview) {
    return (
      <div className="sheet-body">{top}
        <h2 className="title">This invite doesn't work</h2>
        <p className="muted">{error || "The link may have been replaced with a new one. Ask whoever sent it for a fresh link."}</p>
      </div>
    );
  }
  const open = preview.members.filter((m) => !m.taken);
  return (
    <div className="sheet-body">
      {top}
      <span className="kicker">You're invited to</span>
      <h2 className="title">{preview.name}</h2>
      <p className="muted small-text">Which one is you? Picking your name keeps everything already added for you.</p>
      <div className="chips">
        {open.map((m) => (
          <button type="button" key={m.id} className={`chip ${pick === m.id ? "on" : ""}`} aria-pressed={pick === m.id} onClick={() => setPick(m.id)}>{m.name}</button>
        ))}
        <button type="button" className={`chip ${pick === "new" ? "on" : ""}`} aria-pressed={pick === "new"} onClick={() => setPick("new")}>I'm not listed</button>
      </div>
      {preview.members.some((m) => m.taken) && <p className="muted small-text pad-s">Already joined: {preview.members.filter((m) => m.taken).map((m) => m.name).join(", ")}</p>}
      {pick === "new" && <input className="field" placeholder="Your name" aria-label="Your name" value={name} onChange={(e) => setName(e.target.value)} />}
      {error && <p className="warn-text pad-s" role="alert">{error}</p>}
      <button type="button" className="primary" disabled={busy || !pick || (pick === "new" && !name.trim())} onClick={join}>{busy ? "Joining…" : "Join the group"}</button>
    </div>
  );
}

// ---------- Account ----------
export function AccountSheet() {
  return <Sheet surface><AccountBody /></Sheet>;
}

function AccountBody() {
  const nav = useNav();
  const close = useSheetClose();
  const { mode, account } = useStore();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <div className="sheet-body">
      <div className="sheet-top"><button type="button" className="round surface2" aria-label="Close" onClick={close}><Icon name="x" size={20} /></button></div>
      <h2 className="title">Account</h2>

      {mode === "demo" && (
        <>
          <p className="muted">You're looking at demo data. Nothing here is saved or shared.</p>
          <button type="button" className="primary" onClick={() => { exitDemo(); nav.closeAll(); }}>Leave the demo</button>
          <button type="button" className="secondary" onClick={() => { enterDemo(); nav.toast("Demo data reset"); }}>Reset the demo</button>
        </>
      )}

      {mode === "local" && (
        <>
          <p className="muted">Your groups are saved on this phone only. Sharing, invites and emails turn on once the online version is set up.</p>
          <button type="button" className="secondary" onClick={() => { enterDemo(); nav.closeAll(); }}>Try the demo</button>
        </>
      )}

      {mode === "cloud" && account && (
        <>
          <ul className="plain">
            <li><span className="muted">Signed in as</span><span>{account.isGuest ? "Guest" : account.email ?? account.name ?? "you"}</span></li>
          </ul>
          {account.isGuest && (
            <>
              <h3 className="section-title">Keep your groups</h3>
              <p className="muted small-text">Guests lose access if they sign out or clear this browser. Add your email to keep everything and sign in on other phones.</p>
              {sent ? <div className="issue ok"><p>Check {email} and tap the confirm link.</p></div> : (
                <>
                  <input className="field" type="email" inputMode="email" placeholder="you@example.com" aria-label="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
                  <button type="button" className="secondary" disabled={busy || !looksLikeEmail(email)}
                    onClick={async () => {
                      setBusy(true);
                      try { await cloud.upgradeGuest(email.trim()); setSent(true); } catch (e) { nav.toast(errText(e)); } finally { setBusy(false); }
                    }}>Save my account</button>
                </>
              )}
            </>
          )}
          <button type="button" className="secondary" onClick={() => { enterDemo(); nav.closeAll(); }}>Try the demo</button>
          <button type="button" className="danger-btn" onClick={async () => { nav.closeAll(); await cloud.signOut(); }}>Sign out</button>
        </>
      )}
    </div>
  );
}

// ---------- Move groups saved on this phone into the account ----------
export function MovePhoneGroups({ onDone }: { onDone: () => void }) {
  return <Sheet surface><MoveBody onDone={onDone} /></Sheet>;
}

function MoveBody({ onDone }: { onDone: () => void }) {
  const nav = useNav();
  const close = useSheetClose();
  const [groups] = useState(phoneGroups);
  const [picked, setPicked] = useState<string[]>(() => groups.filter((g) => !isSampleGroup(g)).map((g) => g.id));
  const [busy, setBusy] = useState(false);
  const toggle = (id: string) => setPicked(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]);

  return (
    <div className="sheet-body">
      <div className="sheet-top"><button type="button" className="round surface2" aria-label="Close" onClick={close}><Icon name="x" size={20} /></button></div>
      <h2 className="title">Groups on this phone</h2>
      <p className="muted small-text">These were saved on this phone before you had an account. Move the ones you want, so friends can join them and they follow you to other phones.</p>
      <div className="chips">
        {groups.map((g) => (
          <button type="button" key={g.id} className={`chip ${picked.includes(g.id) ? "on" : ""}`} aria-pressed={picked.includes(g.id)} onClick={() => toggle(g.id)}>
            {g.name}{isSampleGroup(g) ? " (sample)" : ""} · {g.expenses.length}
          </button>
        ))}
      </div>
      <button type="button" className="primary" disabled={busy || picked.length === 0} onClick={async () => {
        setBusy(true);
        try {
          await moveFromPhone(picked);
          nav.toast(`Moved ${picked.length} group${picked.length > 1 ? "s" : ""} to your account`);
          onDone();
          close();
        } catch (e) {
          nav.toast(errText(e));
        } finally {
          setBusy(false);
        }
      }}>{busy ? "Moving…" : `Move ${picked.length || ""} to my account`}</button>
      <ConfirmButton className="danger-btn" label="Delete them from this phone" confirmLabel="Tap again: they can't be brought back"
        onConfirm={() => { forgetPhoneGroups(); onDone(); close(); nav.toast("Removed from this phone"); }} />
    </div>
  );
}
