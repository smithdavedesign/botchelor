"use client";

import { useEffect, useRef, type RefObject } from "react";

/**
 * One way for an overlay to behave (2026-11-20 mobile audit, pattern 2): the show's `Sheet` (app/Sheet.tsx) is a native
 * modal <dialog> and gets all of this from the browser; every hand-made menu, popover and full-screen sheet gets it here.
 * While `open`:
 * - the page behind doesn't scroll (html.overlay-open, app/globals.css);
 * - everything outside `root` is `inert`, so Tab stays inside and a screen reader reads only the overlay;
 * - Escape closes it (only the overlay on top, and never under a native modal it opened);
 * - a press outside `root` closes it (`outside: false` to keep it up);
 * - focus moves in when it opens and goes back where it was when it closes.
 * `root` is what stays live: the overlay itself, and for a menu its button too, so the button still toggles it. With no
 * `onClose` nothing closes it from here (the 18+ gate: answering it is the way out).
 */
export function useOverlay(
  open: boolean,
  {
    root,
    onClose,
    outside = true,
    focus,
    lock = true,
  }: {
    root: RefObject<HTMLElement | null>;
    onClose?: () => void;
    outside?: boolean;
    /** Where focus goes when it opens; by default the first control inside `root`, unless focus is in there already. */
    focus?: RefObject<HTMLElement | null>;
    lock?: boolean;
  },
) {
  const close = useRef(onClose);
  close.current = onClose;
  const initial = useRef(focus);
  initial.current = focus;

  useEffect(() => {
    const el = root.current;
    if (!open || !el) return;
    const token = Symbol("overlay");
    stack.push(token);
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const release = inertOutside(el);
    if (lock) lockScroll(1);
    if (!el.contains(document.activeElement)) (initial.current?.current ?? firstControl(el))?.focus({ preventScroll: true });

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || stack.at(-1) !== token || !close.current) return;
      const modal = document.querySelector("dialog:modal");
      if (modal && !el.contains(modal)) return;
      e.preventDefault();
      close.current();
    };
    const onDown = (e: PointerEvent) => {
      if (!outside || !close.current || stack.at(-1) !== token) return;
      const t = e.target as Node | null;
      if (t && el.contains(t)) return;
      // A native modal this overlay opened (a confirm from a menu item) lives in <body>, outside `root`.
      if (t instanceof Element && t.closest("dialog[open]")) return;
      close.current();
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
      stack.splice(stack.indexOf(token), 1);
      release();
      if (lock) lockScroll(-1);
      const now = document.activeElement;
      if (before?.isConnected && (!now || now === document.body || el.contains(now))) before.focus({ preventScroll: true });
    };
  }, [open, root, outside, lock]);
}

/** Overlays open now, newest last: Escape and a press outside are the top one's. */
const stack: symbol[] = [];

let locks = 0;
function lockScroll(by: 1 | -1) {
  locks = Math.max(0, locks + by);
  document.documentElement.classList.toggle("overlay-open", locks > 0);
}

const CONTROLS = 'button:not([disabled]), a[href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';
function firstControl(el: HTMLElement): HTMLElement | null {
  return [...el.querySelectorAll<HTMLElement>(CONTROLS)].find((c) => c.getClientRects().length > 0) ?? null;
}

/** The parts of a tree `inertOutside` walks: an element's parent and its children. A DOM element is one. */
export type InertNode = { parentElement: unknown; children: ArrayLike<unknown>; inert: boolean; tagName: string; hasAttribute(name: string): boolean };

const NEVER = new Set(["SCRIPT", "STYLE", "TEMPLATE", "LINK", "META", "NOSCRIPT"]);
/** What an open overlay made inert, so one opened over it (a sheet over the theater) can lift it from its own branch. */
const ours = new WeakSet<InertNode>();

/**
 * Makes everything on the page `inert` except `keep` and what holds it: every sibling of `keep` and of each of its
 * ancestors up to <body>. What was inert already, and an open native <dialog> (it's in the top layer), are left as they
 * are, except that `keep`'s own branch is lifted where an overlay under it had made it inert. Returns the undo, which
 * puts back only what it changed.
 */
export function inertOutside(keep: InertNode): () => void {
  const set: InertNode[] = [];
  const lifted: InertNode[] = [];
  for (let node: InertNode | null = keep; node && node.tagName !== "BODY"; node = node.parentElement as InertNode | null) {
    if (node.inert && ours.has(node)) {
      node.inert = false;
      lifted.push(node);
    }
    const parent = node.parentElement as InertNode | null;
    if (!parent) break;
    const kids = parent.children;
    for (let i = 0; i < kids.length; i++) {
      const sib = kids[i] as InertNode;
      if (sib === node || sib.inert || NEVER.has(sib.tagName) || (sib.tagName === "DIALOG" && sib.hasAttribute("open"))) continue;
      sib.inert = true;
      ours.add(sib);
      set.push(sib);
    }
  }
  return () => {
    for (const n of set) {
      n.inert = false;
      ours.delete(n);
    }
    for (const n of lifted) n.inert = true;
  };
}
