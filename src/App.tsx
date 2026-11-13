// The app shell: sign-in gate, invite links, three tabs, the floating tab bar and the + button.

import { useEffect, useState } from "react";
import { actions, onStoreError, startCloud, useAppState, useStore } from "./lib/store.ts";
import { AddExpense } from "./screens/AddExpense.tsx";
import { JoinSheet, SignIn } from "./screens/Auth.tsx";
import { NewGroup } from "./screens/shared.tsx";
import { Activity, Home, People } from "./screens/Tabs.tsx";
import { haptic, Icon, NavProvider, useNav } from "./ui/kit.tsx";

type Tab = "home" | "activity" | "people";
type Invite = { code: string; receiptId?: string };

const INVITE_KEY = "allsquare.invite";

/** Reads ?join=CODE(&receipt=ID) once, keeps it through sign-in, and tidies the address bar. */
function takeInvite(): Invite | null {
  const q = new URLSearchParams(window.location.search);
  const code = q.get("join");
  if (code) {
    const invite = { code, receiptId: q.get("receipt") ?? undefined };
    try { sessionStorage.setItem(INVITE_KEY, JSON.stringify(invite)); } catch { /* private mode */ }
    return invite;
  }
  try {
    const saved = sessionStorage.getItem(INVITE_KEY);
    return saved ? (JSON.parse(saved) as Invite) : null;
  } catch {
    return null;
  }
}
const clearInvite = () => {
  try { sessionStorage.removeItem(INVITE_KEY); } catch { /* ignore */ }
  const q = new URLSearchParams(window.location.search);
  if (q.has("join") || q.has("receipt")) {
    q.delete("join");
    q.delete("receipt");
    const rest = q.toString();
    window.history.replaceState(null, "", window.location.pathname + (rest ? `?${rest}` : "") + window.location.hash);
  }
};

export default function App() {
  return (
    <NavProvider>
      <Gate />
    </NavProvider>
  );
}

function Gate() {
  const { mode, status, account } = useStore();
  const nav = useNav();
  const [invite, setInvite] = useState<Invite | null>(takeInvite);

  useEffect(() => void startCloud(), []);
  useEffect(() => {
    const off = onStoreError((m) => nav.toast(m, "x"));
    return () => void off();
  }, [nav]);

  // Signed in with an invite waiting: open the join sheet once.
  useEffect(() => {
    if (mode === "cloud" && status === "ready" && account && invite) {
      nav.open(<JoinSheet code={invite.code} receiptId={invite.receiptId} onDone={() => { clearInvite(); setInvite(null); }} />);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, status, account?.userId, invite?.code]);

  if (mode === "cloud" && status === "loading") {
    return <div className="splash"><span className="wordmark big-mark">Allsquare</span></div>;
  }
  if (mode === "cloud" && status === "signed-out") return <SignIn invited={Boolean(invite)} />;
  return <Shell />;
}

function Shell() {
  const { groups } = useAppState();
  const nav = useNav();
  const [tab, setTab] = useState<Tab>("home");

  // Add any repeating expenses that came due while the app was closed.
  useEffect(() => {
    const onShow = () => document.visibilityState === "visible" && actions.catchUpRecurring();
    document.addEventListener("visibilitychange", onShow);
    return () => document.removeEventListener("visibilitychange", onShow);
  }, []);

  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: "home", label: "Home", icon: "home" },
    { id: "activity", label: "Activity", icon: "activity" },
    { id: "people", label: "People", icon: "people" },
  ];

  return (
    <div className="app">
      <main className="tab-fade" key={tab}>
        {tab === "home" && <Home groups={groups} />}
        {tab === "activity" && <Activity groups={groups} />}
        {tab === "people" && <People groups={groups} />}
      </main>
      <nav className="tabbar glass" aria-label="Tabs">
        {tabs.map((t) => (
          <button type="button" key={t.id} className={tab === t.id ? "on" : ""} aria-current={tab === t.id ? "page" : undefined} onClick={() => setTab(t.id)}>
            <Icon name={t.icon} size={22} />
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
      <button type="button" className="add-fab glass" aria-label="Add expense"
        onClick={() => { haptic(); nav.open(groups.length ? <AddExpense groupId={groups[0].id} /> : <NewGroup />); }}>
        <Icon name="plus" size={28} />
      </button>
    </div>
  );
}
