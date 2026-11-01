"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * One group of the site footer's links (2026-10-31 UX audit: fifteen links in one flat list, ~730px on a phone). Open
 * on a wide screen, where the groups are columns; folded on a phone, where each is a row that opens. It's drawn open
 * and folds once it's in a phone's browser, so a desktop never sees it closed.
 */
export default function FooterGroup({ title, children }: { title: string; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (window.matchMedia("(max-width: 640px)").matches) ref.current?.removeAttribute("open");
  }, []);
  return (
    <details ref={ref} className="footer-group ux-fold" open>
      <summary>{title}</summary>
      <ul className="footer-links">{children}</ul>
    </details>
  );
}
