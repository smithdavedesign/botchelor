"use client";

import { useEffect, useLayoutEffect, useState, type RefObject } from "react";

/**
 * Toasts make room (2026-11-20 mobile audit, B8): the install hint and the beta prompt float at the foot of a phone's
 * screen, and sat over "Get Mira dating" and the cards. While a page's main button is under where the toast would be, it
 * waits (hidden, so it isn't counted as seen); it comes up once the button has scrolled clear. One of them per visit:
 * whichever shows first takes the visit (`claimToastVisit`), and the other waits for another day.
 */

/** A page's main buttons: a filled link-button or a primary button, never a ghost, secondary or text button. */
export const PRIMARY_SELECTOR = [
  "a.button:not(.secondary):not(.button-ghost):not(.small)",
  ".button.primary",
  "button.primary",
  'button[type="submit"]:not(.secondary):not(.button-ghost):not(.link-button):not(.linklike)',
].join(", ");

export type Box = { top: number; bottom: number; left: number; right: number };

/** Whether two boxes overlap, `pad` px apart counting as touching. */
export function overlaps(a: Box, b: Box, pad = 8): boolean {
  return a.left < b.right + pad && b.left < a.right + pad && a.top < b.bottom + pad && b.top < a.bottom + pad;
}

/** Whether a toast at `zone` would sit over any of the page's main buttons on screen. */
export function coversPrimary(zone: Box, toast: Element | null): boolean {
  for (const el of document.querySelectorAll(PRIMARY_SELECTOR)) {
    if (toast?.contains(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0 || r.bottom < 0 || r.top > window.innerHeight) continue;
    if (overlaps(zone, r)) return true;
  }
  return false;
}

/**
 * `waiting`: true while the toast `ref` would cover a main button, so its owner hides it (and doesn't count it as seen).
 * Checked as it comes up, and again on scroll and resize until it's dismissed.
 */
export function useToastRoom(ref: RefObject<HTMLElement | null>, active: boolean): boolean {
  const [waiting, setWaiting] = useState(false);
  const [zone, setZone] = useState<Box | null>(null);
  // Where it sits, read before it paints the first time (it's fixed to the foot, so it stays put as the page scrolls).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!active || !el) return setZone(null);
    const r = el.getBoundingClientRect();
    const at = { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
    setZone(at);
    setWaiting(coversPrimary(at, el));
  }, [active, ref]);
  useEffect(() => {
    if (!active || !zone) return;
    let frame = 0;
    const check = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setWaiting(coversPrimary(zone, ref.current)));
    };
    window.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
    };
  }, [active, zone, ref]);
  return active && waiting;
}

/** sessionStorage: which toast this visit already showed ("install" or "beta"). */
export const TOAST_VISIT_KEY = "bz_toast_visit";

/** Whether `kind` may show this visit: none has, or it was this one. */
export function toastVisitFree(kind: "install" | "beta"): boolean {
  try {
    const taken = sessionStorage.getItem(TOAST_VISIT_KEY);
    return !taken || taken === kind;
  } catch {
    return true;
  }
}

/** This visit's toast is `kind`: the other one waits for another visit. */
export function claimToastVisit(kind: "install" | "beta") {
  try {
    sessionStorage.setItem(TOAST_VISIT_KEY, kind);
  } catch {
    /* storage blocked: the CSS rule that hides the install hint under the beta prompt still holds */
  }
}
