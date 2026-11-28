"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { okJson } from "@/lib/ok-json";

type Premiere = { at: string; state: "scheduled" | "built" | "live"; kind: "pilot" | "weekly"; finale: boolean; lead: string; suitor: string | null; room_path: string | null };

const HOUR = 3_600_000;

/** "2d 4h", "3h 10m", "12 min". */
function left(ms: number): string {
  const mins = Math.max(1, Math.round(ms / 60_000));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ${mins % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

/** "Sun 3 pm", in the viewer's own zone. */
const when = (iso: string) => {
  const d = new Date(iso);
  const day = d.toLocaleDateString(undefined, { weekday: "short" });
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: d.getMinutes() ? "2-digit" : undefined });
  return `${day} ${time}`;
};

/**
 * The show's on-air bar (2026-11-28, Dave: "people should always know when the next drama is"): under the header on
 * every show page. While Sunday's premiere is live, a red "Live now" bar into its room; in the day before it, a night
 * bar counting down; the rest of the week, a small countdown chip. Reads /api/on-air once (kept a minute at the edge),
 * so it costs a page nothing on the server; nothing shows until it answers, and nothing at all with no premiere ahead.
 * Not inside the live room itself, where it would only point at the page it's on. It hangs under the sticky header
 * (absolutely placed), so it never pushes the page down when it arrives, and stays in view as the page scrolls; ✕ puts
 * it away for that premiere, in this tab. Styles: app/ux/broadcast.css.
 */
export default function OnAirBar() {
  const path = usePathname();
  const [p, setP] = useState<Premiere | null>(null);
  const [now, setNow] = useState(0);
  const [hidden, setHidden] = useState<string | null>(null);
  useEffect(() => {
    let gone = false;
    fetch("/api/on-air")
      .then(okJson)
      .then((d: { premiere: Premiere | null } | null) => !gone && setP(d?.premiere ?? null))
      .catch(() => null);
    setNow(Date.now());
    try {
      setHidden(window.sessionStorage.getItem("bz-on-air-hide"));
    } catch {
      /* private window: shown each page */
    }
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      gone = true;
      window.clearInterval(t);
    };
  }, []);
  if (!p || !now) return null;
  const at = Date.parse(p.at);
  const live = p.state === "live" || (p.room_path !== null && now >= at);
  if (live && p.room_path && path === p.room_path) return null;
  const mode = live ? "live" : at - now <= 24 * HOUR ? "soon" : "week";
  const key = `${p.at}:${mode}`;
  if (hidden === key) return null;
  const close = (
    <button
      type="button"
      className="on-air-close"
      aria-label="Hide this"
      onClick={() => {
        setHidden(key);
        try {
          window.sessionStorage.setItem("bz-on-air-hide", key);
        } catch {
          /* hidden for this page only */
        }
      }}
    >
      ✕
    </button>
  );
  const name = p.kind === "pilot" ? "Meet the lead" : p.finale ? "The finale's premiere" : "Sunday's premiere";
  const what = p.kind === "pilot" ? `${p.lead}'s first night` : p.suitor ? `${p.lead}'s last-chance date with ${p.suitor}` : `${p.lead}'s last-chance date`;
  if (live) {
    return (
      <div className="on-air-bar is-live" data-on-air="live">
        <span className="on-air-dot" aria-hidden="true" />
        <strong>Live now</strong>
        <span className="on-air-what">
          {name}: {what}
        </span>
        {p.room_path && (
          <Link href={p.room_path} className="on-air-go" data-track="on-air-watch">
            Watch →
          </Link>
        )}
        {close}
      </div>
    );
  }
  if (mode === "soon") {
    return (
      <div className="on-air-bar is-soon" data-on-air="soon">
        <strong>Tonight</strong>
        <span className="on-air-what">
          {name}: {what}, {when(p.at)}
        </span>
        <span className="on-air-left">in {left(at - now)}</span>
        {close}
      </div>
    );
  }
  return (
    <div className="on-air-bar is-week" data-on-air="week">
      <Link href="/watch#rose-ceremony" className="on-air-chip" data-track="on-air-chip">
        <span className="on-air-dot" aria-hidden="true" />
        {name} · {when(p.at)} · <span className="on-air-left">{left(at - now)}</span>
      </Link>
      {close}
    </div>
  );
}
