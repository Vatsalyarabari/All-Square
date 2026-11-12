// The review page. Money only moves after a deliberate swipe up (spec §8).

import { useEffect, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from "react";
import { haptic, Icon, useNav } from "./kit.tsx";

type Phase = "opening" | "idle" | "dragging" | "spring" | "fly" | "flood" | "dome" | "reveal";

export function Review({ title, children, note, verb, toastText, onConfirm }: {
  title: string;
  children: ReactNode;
  note: string;
  verb: "add" | "settle" | "save";
  toastText: string;
  onConfirm: () => void;
}) {
  const nav = useNav();
  const [phase, setPhase] = useState<Phase>("opening");
  const [dy, setDy] = useState(0);
  const drag = useRef<{ y: number; t: number; lastY: number; lastT: number } | null>(null);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setPhase("idle")));
    const t = timers.current;
    return () => {
      cancelAnimationFrame(raf);
      t.forEach(clearTimeout);
    };
  }, []);

  function confirm() {
    if (["fly", "flood", "dome", "reveal"].includes(phase)) return;
    haptic(25);
    setPhase("fly"); // t=0: page flies off the top
    const at = (ms: number, fn: () => void) => timers.current.push(window.setTimeout(fn, ms));
    at(250, () => setPhase("flood")); // screen floods
    at(550, () => {
      onConfirm(); // data committed; sheets close underneath
      setPhase("dome");
    });
    at(1060, () => {
      setPhase("reveal");
      nav.toast(toastText);
    });
    at(1440, () => nav.closeAll()); // idle again, review removed
  }

  const down = (e: RPointerEvent<HTMLDivElement>) => {
    if (phase !== "idle" && phase !== "spring") return;
    const box = e.currentTarget.getBoundingClientRect();
    if (e.clientY < box.top + box.height * 0.58) return; // only the lower 42% is draggable
    e.preventDefault();
    drag.current = { y: e.clientY, t: performance.now(), lastY: e.clientY, lastT: performance.now() };
    e.currentTarget.setPointerCapture(e.pointerId);
    setPhase("dragging");
  };
  const move = (e: RPointerEvent) => {
    if (!drag.current) return;
    drag.current = { ...drag.current, lastY: e.clientY, lastT: performance.now() };
    setDy(e.clientY - drag.current.y);
  };
  const up = (e: RPointerEvent) => {
    if (!drag.current) return;
    const d = drag.current;
    drag.current = null;
    const pulled = d.y - e.clientY;
    const dt = Math.max(1, performance.now() - d.t);
    const flick = pulled / dt > 0.8 && pulled > 20;
    if (pulled > 120 || flick) confirm();
    else {
      setDy(0);
      setPhase("spring");
    }
  };

  const pageY = phase === "opening" ? "100%" : phase === "dragging" ? `${dy < 0 ? dy * 0.85 : dy * 0.15}px` : ["fly", "flood", "dome", "reveal"].includes(phase) ? "-110%" : "0px";
  const glowLift = phase === "dragging" && dy < 0 ? -dy * 0.6 : 0;
  const busy = ["fly", "flood", "dome", "reveal"].includes(phase);

  return (
    <div className={`review phase-${phase}`} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
      <div className="review-band" aria-hidden={busy}>
        <div className="review-glow" style={{ transform: `translateY(${-glowLift}px)`, opacity: glowLift ? Math.min(1, 0.75 + glowLift / 300) : undefined }} />
        <span className="review-hint">↑ Swipe up to {verb}</span>
      </div>
      <article className="review-page" style={{ transform: `translateY(${pageY})` }}>
        <header className="review-head">
          <button type="button" className="round surface2" aria-label="Back" onClick={nav.closeTop} disabled={busy}>
            <Icon name="back" size={20} />
          </button>
          <span className="kicker">Review</span>
        </header>
        <h2 className="title">{title}</h2>
        <div className="review-rows">{children}</div>
        <p className="review-note">{note}</p>
        <button type="button" className="sr-only" onClick={confirm}>Confirm and {verb}</button>
      </article>
      {["flood", "dome", "reveal"].includes(phase) && <div className="flood" />}
      {["dome", "reveal"].includes(phase) && <div className="dome"><div className="dome-rim" /></div>}
    </div>
  );
}

export function ReviewRow({ label, value, indent }: { label: string; value: ReactNode; indent?: boolean }) {
  return (
    <div className={`rrow ${indent ? "indent" : ""}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
