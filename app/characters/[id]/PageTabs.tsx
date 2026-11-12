"use client";

import { useCallback, useEffect, useState } from "react";

export type PageTab = { id: string; label: string };

/**
 * A character page in tabs (the design system's character page, all-screens board, 2026-11-11): one part at a time
 * instead of five phone screens of cards. Each tab shows the `[data-panel="<id>"]` block of the page and hides the
 * others; the first is open from the server, the rest arrive `hidden`. A link to anything inside a panel (#secrets,
 * #date-record, #relationships) opens that panel, so old links still land.
 */
export default function PageTabs({ tabs }: { tabs: PageTab[] }) {
  const [active, setActive] = useState(tabs[0]?.id ?? "");

  const show = useCallback(
    (id: string) => {
      if (!tabs.some((t) => t.id === id)) return;
      setActive(id);
      for (const t of tabs) {
        const panel = document.querySelector<HTMLElement>(
          `[data-panel="${t.id}"]`,
        );
        if (panel) panel.hidden = t.id !== id;
      }
    },
    [tabs],
  );

  // The panel holding the element a link points at, if any.
  const fromHash = useCallback(() => {
    const target = window.location.hash.slice(1);
    if (!target) return;
    const el = document.getElementById(target);
    const panel =
      el?.closest<HTMLElement>("[data-panel]")?.dataset.panel ??
      (tabs.some((t) => t.id === target) ? target : null);
    if (panel) {
      show(panel);
      requestAnimationFrame(() => el?.scrollIntoView({ block: "start" }));
    }
  }, [show, tabs]);

  useEffect(() => {
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, [fromHash]);

  return (
    <div className="page-tabs" role="tablist" aria-label="On this page">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          id={`tab-${t.id}`}
          aria-selected={t.id === active}
          aria-controls={`panel-${t.id}`}
          className={t.id === active ? "is-active" : undefined}
          onClick={() => show(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
