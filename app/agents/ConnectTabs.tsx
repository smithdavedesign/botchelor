"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";

export type ConnectTab = { key: string; tab: string; label: string; code: string };

/**
 * The ways to connect, as one code block with tabs. The server renders every panel with its own label, so crawlers and
 * readers without JS get all four; once this runs, a tab row takes over and shows one at a time, with a copy button.
 */
export default function ConnectTabs({ tabs }: { tabs: ConnectTab[] }) {
  const [ready, setReady] = useState(false);
  const [active, setActive] = useState(tabs[0]?.key ?? "");
  const [copied, setCopied] = useState<string | null>(null);
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  useEffect(() => setReady(true), []);

  function onKey(e: KeyboardEvent<HTMLButtonElement>, i: number) {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = tabs[(i + step + tabs.length) % tabs.length];
    setActive(next.key);
    refs.current[next.key]?.focus();
  }

  async function copy(t: ConnectTab) {
    try {
      await navigator.clipboard?.writeText(t.code);
      setCopied(t.key);
    } catch {
      setCopied(null); // the text is selectable in the block either way
    }
  }

  return (
    <div className={`connect-tabs${ready ? " is-ready" : ""}`}>
      {ready && (
        <div className="tabs" role="tablist" aria-label="How to connect">
          {tabs.map((t, i) => (
            <button
              key={t.key}
              ref={(el) => {
                refs.current[t.key] = el;
              }}
              type="button"
              role="tab"
              id={`connect-tab-${t.key}`}
              aria-selected={active === t.key}
              aria-controls={`connect-panel-${t.key}`}
              tabIndex={active === t.key ? 0 : -1}
              onClick={() => setActive(t.key)}
              onKeyDown={(e) => onKey(e, i)}
            >
              {t.tab}
            </button>
          ))}
        </div>
      )}
      {tabs.map((t) => (
        <div
          key={t.key}
          id={`connect-panel-${t.key}`}
          className="connect-panel"
          role={ready ? "tabpanel" : undefined}
          aria-labelledby={ready ? `connect-tab-${t.key}` : undefined}
          hidden={ready && active !== t.key}
        >
          <p className="code-label">{t.label}</p>
          <div className="connect-code">
            <pre className="code-block" tabIndex={0}>
              <code>{t.code}</code>
            </pre>
            {ready && (
              <button type="button" className="secondary connect-copy" onClick={() => copy(t)}>
                {copied === t.key ? "Copied" : "Copy"}
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
