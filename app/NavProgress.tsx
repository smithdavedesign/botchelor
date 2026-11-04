"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/** How long a bar may run before it gives up (a link whose click was cancelled, say): it never sticks. */
const GIVE_UP_MS = 12_000;
/** A page that arrives sooner than this never shows the bar (it fades in after it: .nav-progress). */
const QUICK_MS = 150;

/**
 * A thin bar across the top of the page from the moment a link to another page of the site is tapped until that page
 * is on screen (the 2026-11-04 performance audit, David: "it looks like my click didn't do anything"). The heavy pages
 * also have a loading screen (app/PageLoading.tsx); this covers the rest, and a slow network where that screen hasn't
 * been fetched yet. A quick page never shows it: it fades in only after a moment. Styles are `.nav-progress`.
 */
export default function NavProgress() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const [state, setState] = useState<"idle" | "going" | "done">("idle");
  const giveUp = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedAt = useRef(0);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      // Not a plain click (a new tab, a download), or not a link to another page here: nothing to wait for.
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a");
      if (!(a instanceof HTMLAnchorElement) || !a.href || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
      const to = new URL(a.href, location.href);
      if (to.origin !== location.origin) return;
      if (to.pathname === location.pathname && to.search === location.search) return; // this page, or a #part of it
      startedAt.current = performance.now();
      setState("going");
      if (giveUp.current) clearTimeout(giveUp.current);
      giveUp.current = setTimeout(() => setState("idle"), GIVE_UP_MS);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  // The new page is here: finish the bar, then put it away.
  useEffect(() => {
    if (giveUp.current) clearTimeout(giveUp.current);
    const quick = performance.now() - startedAt.current < QUICK_MS;
    setState((s) => (s === "going" && !quick ? "done" : s === "going" ? "idle" : s));
    const t = setTimeout(() => setState("idle"), 350);
    return () => clearTimeout(t);
  }, [pathname, search]);

  return (
    <div className="nav-progress" data-state={state} aria-hidden="true">
      <span className="nav-progress-bar" />
    </div>
  );
}
