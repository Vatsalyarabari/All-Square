// Shared building blocks: icons, sheets, chips, number pad, haptics, navigation and toasts.

import {
  createContext, useCallback, useContext, useEffect, useRef, useState,
  type CSSProperties, type PointerEvent as RPointerEvent, type ReactNode,
} from "react";
import { padInput } from "../lib/money.ts";

// ---------- Haptics ----------
export function haptic(ms = 10) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    // not supported (iPhone Safari): silently skip
  }
}

// ---------- Icons ----------
const paths: Record<string, string> = {
  home: "M4 11.5 12 5l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z",
  activity: "M4 6h16M4 12h16M4 18h10",
  people: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm-6 9c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5M16.5 11a3 3 0 1 0 0-6M18 14.8c2 .6 3.5 2.4 3.5 5.2",
  plus: "M12 5v14M5 12h14",
  x: "M6 6l12 12M18 6 6 18",
  eye: "M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Zm9.5 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  eyeOff: "M3 3l18 18M10.6 6.1A9.5 9.5 0 0 1 12 6c6 0 9.5 6 9.5 6a16 16 0 0 1-3 3.6M6.2 7.6C3.9 9.3 2.5 12 2.5 12S6 18 12 18c1.6 0 3-.4 4.2-1M9.9 9.9a3 3 0 0 0 4.2 4.2",
  bell: "M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0",
  arrow: "M5 12h14M13 6l6 6-6 6",
  chevron: "M9 6l6 6-6 6",
  down: "M6 9l6 6 6-6",
  back: "M15 6l-6 6 6 6",
  scan: "M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M7 12h10",
  settle: "M7 7h11l-3-3M17 17H6l3 3",
  send: "M21 3 10.5 13.5M21 3l-6.5 18-4-7.5L3 9.5z",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm5-2 4.5 4.5",
  gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 13.5l1.6 1.2-2 3.4-1.9-.7a7.6 7.6 0 0 1-1.7 1L15 20.5h-4l-.4-2.1a7.6 7.6 0 0 1-1.7-1l-1.9.7-2-3.4 1.6-1.2a7.5 7.5 0 0 1 0-3L4.6 9.3l2-3.4 1.9.7a7.6 7.6 0 0 1 1.7-1L10.6 3.5h4l.4 2.1a7.6 7.6 0 0 1 1.7 1l1.9-.7 2 3.4-1.6 1.2a7.5 7.5 0 0 1 0 3Z",
  camera: "M4 8h3l2-2.5h6L17 8h3v11H4zM12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z",
  copy: "M8 8h11v12H8zM5 16V4h11",
  repeat: "M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4",
};
export function Icon({ name, size = 22, style }: { name: keyof typeof paths | string; size?: number; style?: CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden style={style}>
      <path d={paths[name]} />
    </svg>
  );
}

export function RoundButton({ icon, label, onClick, dark, size = 40, className = "" }: { icon: string; label: string; onClick: () => void; dark?: boolean; size?: number; className?: string }) {
  return (
    <button type="button" aria-label={label} className={`round ${dark ? "glass-dark" : "glass"} ${className}`} style={{ width: size, height: size }} onClick={onClick}>
      <Icon name={icon} size={size > 50 ? 26 : 20} />
    </button>
  );
}

// ---------- Navigation: a stack of sheets, plus toasts ----------
type Layer = { id: number; node: ReactNode };
type Nav = {
  open: (node: ReactNode) => void;
  closeTop: () => void;
  closeAll: () => void;
  toast: (message: string, icon?: string) => void;
};
const NavContext = createContext<Nav>(null!);
export const useNav = () => useContext(NavContext);

let layerSeq = 0;
export function NavProvider({ children }: { children: ReactNode }) {
  const [layers, setLayers] = useState<Layer[]>([]);
  const [toast, setToast] = useState<{ id: number; text: string; icon: string; leaving: boolean } | null>(null);
  const timers = useRef<number[]>([]);

  const nav: Nav = {
    open: useCallback((node: ReactNode) => setLayers((l) => [...l, { id: ++layerSeq, node }]), []),
    closeTop: useCallback(() => setLayers((l) => l.slice(0, -1)), []),
    closeAll: useCallback(() => setLayers([]), []),
    toast: useCallback((text: string, icon = "send") => {
      timers.current.forEach(clearTimeout);
      const id = Date.now();
      setToast({ id, text, icon, leaving: false });
      timers.current = [
        window.setTimeout(() => setToast((t) => (t && t.id === id ? { ...t, leaving: true } : t)), 3000),
        window.setTimeout(() => setToast((t) => (t && t.id === id ? null : t)), 3250),
      ];
    }, []),
  };

  return (
    <NavContext.Provider value={nav}>
      {children}
      {layers.map((l, i) => (
        <LayerContext.Provider key={l.id} value={{ depth: i, isTop: i === layers.length - 1 }}>
          {l.node}
        </LayerContext.Provider>
      ))}
      {toast && (
        <div className={`toast ${toast.leaving ? "leaving" : ""}`} role="status" key={toast.id}>
          <Icon name={toast.icon} size={18} /> {toast.text}
        </div>
      )}
    </NavContext.Provider>
  );
}
const LayerContext = createContext({ depth: 0, isTop: true });

// ---------- Sheet: slides up, swipe down to close ----------
const SheetClose = createContext<() => void>(() => {});
export const useSheetClose = () => useContext(SheetClose);

export function Sheet({ children, className = "", surface }: { children: ReactNode; className?: string; surface?: boolean }) {
  const nav = useNav();
  const { depth } = useContext(LayerContext);
  const [shown, setShown] = useState(false);
  const [drag, setDrag] = useState(0);
  const start = useRef<number | null>(null);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const close = useCallback(() => {
    setShown(false);
    setDrag(0);
    window.setTimeout(nav.closeTop, 340);
  }, [nav]);

  const down = (e: RPointerEvent) => {
    start.current = e.clientY;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const move = (e: RPointerEvent) => start.current !== null && setDrag(Math.max(0, e.clientY - start.current));
  const up = () => {
    if (start.current === null) return;
    start.current = null;
    if (drag > 100) close();
    else setDrag(0);
  };

  const dragging = start.current !== null;
  const offset = shown ? drag : window.innerHeight;
  return (
    <SheetClose.Provider value={close}>
      <div className="backdrop" style={{ opacity: shown ? Math.max(0, 1 - drag / 400) : 0, zIndex: 20 + depth * 2 }} onClick={close} />
      <section
        className={`sheet ${surface ? "surface" : ""} ${className}`}
        role="dialog"
        aria-modal="true"
        style={{ transform: `translateY(${offset}px)`, transition: dragging ? "none" : undefined, zIndex: 21 + depth * 2, top: 50 + depth * 10 }}
      >
        <div className="grab-zone" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
          <div className="grabber" />
        </div>
        {children}
      </section>
    </SheetClose.Provider>
  );
}

// ---------- Chips ----------
export function Chips({ options, selected, onToggle, small }: { options: { id: string; label: string }[]; selected: string[]; onToggle: (id: string) => void; small?: boolean }) {
  return (
    <div className="chips">
      {options.map((o) => (
        <button type="button" key={o.id} className={`chip ${small ? "small" : ""} ${selected.includes(o.id) ? "on" : ""}`} aria-pressed={selected.includes(o.id)} onClick={() => onToggle(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------- Number pad ----------
export function NumberPad({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "⌫"];
  return (
    <div className="numpad" role="group" aria-label="Number pad">
      {keys.map((k) => (
        <button type="button" key={k} aria-label={k === "⌫" ? "Delete" : k} onClick={() => onChange(padInput(value, k))}>
          {k}
        </button>
      ))}
    </div>
  );
}

/** Asks for a second tap instead of a pop-up, which some hosts and phones block. */
export function ConfirmButton({ label, confirmLabel, onConfirm, className = "" }: { label: string; confirmLabel: string; onConfirm: () => void; className?: string }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button type="button" className={`${className} ${armed ? "armed" : ""}`} onClick={() => (armed ? onConfirm() : (haptic(), setArmed(true)))}>
      {armed ? confirmLabel : label}
    </button>
  );
}

// ---------- Copy or share text ----------
export async function shareText(text: string, nav: Nav, done = "Copied") {
  try {
    if (navigator.share) {
      await navigator.share({ text });
      return;
    }
  } catch {
    // share sheet cancelled or blocked: fall back to copying
  }
  try {
    await navigator.clipboard.writeText(text);
    nav.toast(done, "copy");
  } catch {
    nav.toast("Couldn't copy here. Long-press to select instead.", "copy");
  }
}

/** Diverging bar: positive grows right of the centre line, negative grows left. */
export function DivergingBar({ name, cents, max, onDark, delay = 0, label }: { name: string; cents: number; max: number; onDark?: boolean; delay?: number; label: string }) {
  const width = max ? (Math.abs(cents) / max) * 46 : 0;
  const pos = cents >= 0;
  return (
    <div className={`dbar ${onDark ? "on-dark" : ""}`}>
      <span className="dbar-name">{name}</span>
      <span className="dbar-track">
        <span className="dbar-axis" />
        <span className={`dbar-fill ${pos ? "pos" : "neg"}`} style={{ width: `${width}%`, [pos ? "left" : "right"]: "50%", animationDelay: `${delay}ms` } as CSSProperties} />
      </span>
      <span className={`dbar-amt ${cents > 0 ? "pos" : cents < 0 ? "neg" : ""}`}>{label}</span>
    </div>
  );
}
