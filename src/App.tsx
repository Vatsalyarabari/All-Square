// The app shell: three tabs, the floating tab bar and the + button.

import { useEffect, useState } from "react";
import { actions, useAppState } from "./lib/store.ts";
import { AddExpense } from "./screens/AddExpense.tsx";
import { NewGroup } from "./screens/shared.tsx";
import { Activity, Home, People } from "./screens/Tabs.tsx";
import { haptic, Icon, NavProvider, useNav } from "./ui/kit.tsx";

type Tab = "home" | "activity" | "people";

export default function App() {
  return (
    <NavProvider>
      <Shell />
    </NavProvider>
  );
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
