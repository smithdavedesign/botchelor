"use client";

import { useEffect, useRef, type MouseEvent, type ReactNode } from "react";
import Icon from "./Icon";

const PHONE = "(max-width: 640px)";

/**
 * One group of the site footer's links, as the design system draws the footer (SiteFooter: The show · Tools · Company ·
 * Help and legal). Open on a wide screen, where the groups are columns; folded on a phone, where each is a row that
 * opens with a chevron. It's drawn open and folds once it's in a phone's browser, so a desktop never sees it closed. On
 * a wide screen the title is a column heading: neither a click nor Enter folds it, and it's not a tab stop.
 *
 * Back on 2026-11-16 ("our footer should match the designs"): the 2026-11-14 audit had cut the footer to one row; the
 * folding rows keep a phone's footer about as short as that row was.
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
    <details ref={ref} className="footer-group" open>
      <summary onClick={holdOpen}>
        <span>{title}</span>
        <Icon name="chevronRight" className="footer-chev" />
      </summary>
      <ul className="footer-links">{children}</ul>
    </details>
  );
}
