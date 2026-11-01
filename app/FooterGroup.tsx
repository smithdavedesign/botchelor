"use client";

import { useEffect, useRef, type MouseEvent, type ReactNode } from "react";

const PHONE = "(max-width: 640px)";

/**
 * One group of the site footer's links (2026-10-31 UX audit: fifteen links in one flat list, ~730px on a phone). Open
 * on a wide screen, where the groups are columns; folded on a phone, where each is a row that opens. It's drawn open
 * and folds once it's in a phone's browser, so a desktop never sees it closed. On a wide screen the title is a column
 * heading: neither a click nor Enter folds it, and it's not a tab stop.
 */
export default function FooterGroup({ title, children }: { title: string; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const phone = window.matchMedia(PHONE);
    const fit = () => {
      const summary = ref.current?.querySelector("summary");
      if (summary) summary.tabIndex = phone.matches ? 0 : -1;
      if (!phone.matches) ref.current?.setAttribute("open", "");
    };
    if (phone.matches) ref.current?.removeAttribute("open");
    fit();
    phone.addEventListener("change", fit);
    return () => phone.removeEventListener("change", fit);
  }, []);
  const holdOpen = (event: MouseEvent) => {
    if (!window.matchMedia(PHONE).matches) event.preventDefault();
  };
  return (
    <details ref={ref} className="footer-group ux-fold" open>
      <summary onClick={holdOpen}>{title}</summary>
      <ul className="footer-links">{children}</ul>
    </details>
  );
}
