"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";

/** The menu's items that are showing: a wide screen hides the chats group (its ▾ switcher has room there). */
const itemsIn = (panel: HTMLElement | null) =>
  [...(panel?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])].filter((el) => el.getClientRects().length > 0);

/**
 * ⋯ on the thread page's header (TextPhone page mode): everything there that isn't the next step, in one menu: their
 * dates and story, whose phone it is, a double date, the other chats, Unmatch. 2026-10-31 UX audit: on a phone, ⓘ,
 * 💞💞 Double? and ⋯ beside the action button squeezed the name out of the header (David: "make sure its not crowded
 * we group things"). A menu button as WAI-ARIA has it: opening focuses the first item, ↑ ↓ Home End move, Esc closes
 * back to ⋯, Tab or an outside click closes. A choice (an item with `data-close`) closes it and puts focus back on ⋯,
 * so a modal an item opens (app/Sheet.tsx) returns there. Its items stay mounted while it's shut, so that modal stays up.
 */
export default function ThreadMenu({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    itemsIn(panel.current)[0]?.focus();
    const onDown = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const move = (e: ReactKeyboardEvent) => {
    const list = itemsIn(panel.current);
    const at = list.indexOf(document.activeElement as HTMLElement);
    const go = (i: number) => {
      e.preventDefault();
      list[(i + list.length) % list.length]?.focus();
    };
    if (e.key === "ArrowDown") go(at + 1);
    else if (e.key === "ArrowUp") go(at - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(list.length - 1);
    else if (e.key === "Tab") setOpen(false);
  };

  return (
    <span className="thread-menu" ref={box}>
      <button
        ref={button}
        type="button"
        className="phone-head-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={`${id}-menu`}
        aria-label={label}
        title="More"
        onClick={() => setOpen((v) => !v)}
      >
        ⋯
      </button>
      <div
        ref={panel}
        id={`${id}-menu`}
        className="thread-menu-panel"
        role="menu"
        aria-label={label}
        hidden={!open}
        onKeyDown={move}
        onClick={(e) => {
          if (!(e.target as HTMLElement).closest("[data-close]")) return;
          setOpen(false);
          button.current?.focus();
        }}
      >
        {children}
      </div>
    </span>
  );
}
