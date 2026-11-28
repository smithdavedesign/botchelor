"use client";

import { useCallback, useEffect, useState } from "react";
import { useT } from "@/app/I18nProvider";

/** `short`: the label on a phone, where the row has no room for the long one ("Talk of the house" / "Talk"). */
export type PageTab = { id: string; label: string; short?: string };

/**
 * A character page in tabs (the design system's character page, all-screens board, 2026-11-11): one part at a time
 * instead of five phone screens of cards. Each tab shows the `[data-panel="<id>"]` block of the page and hides the
 * others; the first is open from the server, the rest arrive `hidden`. A link to anything inside a panel (#secrets,
 * #date-record, #relationships) opens that panel, so old links still land; when it points at a fold (#audience, the
 * reviews under Talk since 2026-11-15) or into one, the fold opens too.
 */
export default function PageTabs({ tabs }: { tabs: PageTab[] }) {
  const [active, setActive] = useState(tabs[0]?.id ?? "");
  const t = useT();

  const show = useCallback(
    (id: string) => {
      if (!tabs.some((tab) => tab.id === id)) return;
      setActive(id);
      for (const tab of tabs) {
        const panel = document.querySelector<HTMLElement>(
          `[data-panel="${tab.id}"]`,
        );
        if (panel) panel.hidden = tab.id !== id;
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
      (tabs.some((tab) => tab.id === target) ? target : null);
    if (panel) {
      show(panel);
      // A link to a fold, or to something inside one, opens it: a closed <details> has nothing to scroll to.
      for (let fold = el?.closest("details"); fold; fold = fold.parentElement?.closest("details")) fold.open = true;
      requestAnimationFrame(() => el?.scrollIntoView({ block: "start" }));
    }
  }, [show, tabs]);

  useEffect(() => {
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, [fromHash]);

  return (
    <div className="page-tabs" role="tablist" aria-label={t("On this page")}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          id={`tab-${tab.id}`}
          aria-selected={tab.id === active}
          aria-controls={`panel-${tab.id}`}
          className={tab.id === active ? "is-active" : undefined}
          onClick={() => show(tab.id)}
        >
          {tab.short ? (
            <>
              <span className="tab-long">{tab.label}</span>
              <span className="tab-short">{tab.short}</span>
            </>
          ) : (
            tab.label
          )}
        </button>
      ))}
    </div>
  );
}
