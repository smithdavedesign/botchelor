"use client";

import { useEffect, useRef, useState } from "react";

/**
 * One Share button (2026-10-31 UX audit, D3: a five-line share form under every episode): the phone's own share sheet
 * where there is one, else a small popover with Copy link and any `targets` (Reddit, Bluesky) that open with the link
 * filled in. `path` is the app's own page; it becomes an absolute link here.
 */
export default function ShareButton({
  path,
  title,
  targets = [],
  note,
  label = "🔗 Share",
  field,
}: {
  path: string;
  title: string;
  targets?: { label: string; href: string }[];
  note?: string;
  label?: string;
  /** The link itself in a field to select, with this label (the episode's "Episode link"). */
  field?: string;
}) {
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(path);
  useEffect(() => setShown(window.location.origin + path), [path]);
  const [copied, setCopied] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const url = () => new URL(path, window.location.origin).toString();
  async function share() {
    if (typeof navigator.share === "function" && window.matchMedia("(pointer: coarse)").matches) {
      await navigator.share({ title, url: url() }).catch(() => null);
      return;
    }
    setCopied(false);
    setOpen((o) => !o);
  }
  async function copy() {
    const ok = await navigator.clipboard?.writeText(url()).then(() => true, () => false);
    setCopied(Boolean(ok));
  }

  return (
    <span className="share-button" ref={box}>
      <button type="button" className="secondary small" aria-expanded={open} aria-haspopup="true" onClick={() => void share()}>
        {label}
      </button>
      {/* Rendered hidden rather than not at all, so its links are in the page for crawlers and the share tests. */}
      <span className="share-pop card" role="group" aria-label="Share" hidden={!open}>
          {field && <input type="text" readOnly value={shown} aria-label={field} onFocus={(e) => e.currentTarget.select()} />}
          <button type="button" className="secondary small" onClick={() => void copy()}>
            {copied ? "Link copied ✓" : "Copy link"}
          </button>
          {targets.map((t) => (
            <a key={t.label} className="button-ghost small" href={t.href} target="_blank" rel="noopener noreferrer">
              {t.label}
            </a>
          ))}
          {note && <span className="muted small share-pop-note">{note}</span>}
      </span>
    </span>
  );
}
