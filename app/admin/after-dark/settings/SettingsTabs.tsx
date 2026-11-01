"use client";

import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";

export type SettingsTab = { key: string; label: string; panel: ReactNode };

/**
 * The settings in tabs (2026-10-31 UX audit, E3: one page about 9½ phone screens long), the tab in the address
 * (`?tab=`) so a link opens it. Every panel stays mounted, only hidden, so a field typed in one tab and not saved yet
 * is still there on the way back.
 */
export default function SettingsTabs({ tabs, initial }: { tabs: SettingsTab[]; initial: string }) {
  const [tab, setTab] = useState(tabs.some((t) => t.key === initial) ? initial : tabs[0].key);
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  function pick(key: string) {
    setTab(key);
    const url = new URL(window.location.href);
    if (key === tabs[0].key) url.searchParams.delete("tab");
    else url.searchParams.set("tab", key);
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }
  function onKey(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    const moves: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, Home: -index, End: tabs.length - 1 - index };
    if (!(e.key in moves)) return;
    e.preventDefault();
    const next = tabs[(index + moves[e.key] + tabs.length) % tabs.length].key;
    pick(next);
    refs.current[next]?.focus();
  }

  return (
    <>
      <div className="tabs" role="tablist" aria-label="After Dark settings">
        {tabs.map((t, i) => (
          <button
            key={t.key}
            ref={(el) => {
              refs.current[t.key] = el;
            }}
            type="button"
            role="tab"
            id={`ad-tab-${t.key}`}
            aria-selected={tab === t.key}
            aria-controls={`ad-panel-${t.key}`}
            tabIndex={tab === t.key ? 0 : -1}
            onClick={() => pick(t.key)}
            onKeyDown={(e) => onKey(e, i)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tabs.map((t) => (
        <div key={t.key} role="tabpanel" id={`ad-panel-${t.key}`} aria-labelledby={`ad-tab-${t.key}`} hidden={tab !== t.key}>
          {t.panel}
        </div>
      ))}
    </>
  );
}
