"use client";

import Link from "next/link";
import { useState } from "react";
import { requestJson } from "@/app/request";
import type { AdminShort, NightOption, ShortsPanel as Panel } from "@/lib/adult/shorts";
import styles from "@/app/after-dark/shorts/shorts.module.css";

const mediaUrl = (id: string) => `/api/admin/after-dark/media/${encodeURIComponent(id)}`;
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

/**
 * 📺 Shorts, on a pair's page (admins only, house pairs only; lib/adult/shorts.ts). Each saved night, whole: publish it
 * as a Short with a title (PG: it shows on the teaser), a cover (a picture of the two of them, checked before it was
 * stored) and the night's video when one filmed it; or take a published one down again. Loaded when opened.
 */
export default function ShortsPanel({ a, b }: { a: { id: string; name: string }; b: { id: string; name: string } }) {
  const [panel, setPanel] = useState<Panel | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const res = await fetch(`/api/admin/after-dark/shorts?a=${encodeURIComponent(a.id)}&b=${encodeURIComponent(b.id)}`).catch(() => null);
    const data = res?.ok ? ((await res.json()) as { panel: Panel }) : null;
    if (!data) return setError("The Shorts panel didn't load. Try again.");
    setError(null);
    setPanel(data.panel);
  }

  const published = panel?.nights.filter((n) => n.short?.published).length ?? null;
  return (
    <details className="ad-panel ad-shorts" onToggle={(e) => (e.currentTarget.open && !panel ? void load() : undefined)}>
      <summary>📺 Shorts{published ? ` (${published} published)` : ""}</summary>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!panel ? (
        !error && <p className="muted small">Loading…</p>
      ) : !panel.allowed ? (
        <p className="muted small">{panel.why}</p>
      ) : (
        <>
          <p className="muted small">
            Publish a whole night of theirs as a Short: subscribers watch it at <Link href="/after-dark/shorts">After Dark Shorts</Link>, everyone else sees a
            blurred teaser with the title. Your notes on each line (why, memory, facts) never go with it.
          </p>
          {panel.nights.length ? (
            <ul className={styles.nights}>
              {panel.nights.map((n) => (
                <Night key={n.id} night={n} panel={panel} a={a} b={b} onShort={(s) => setPanel((p) => p && { ...p, nights: p.nights.map((x) => (x.id === n.id ? { ...x, short: s } : x)) })} />
              ))}
            </ul>
          ) : (
            <p className="muted small">No saved nights yet: 🌙 End the night (in the theater&apos;s ⋯) files the night that ran.</p>
          )}
        </>
      )}
    </details>
  );
}

function Night({ night, panel, a, b, onShort }: { night: NightOption; panel: Panel; a: { id: string }; b: { id: string }; onShort: (s: AdminShort) => void }) {
  const [title, setTitle] = useState(night.short?.title ?? night.suggested_title);
  const [cover, setCover] = useState<string | null>(night.cover);
  const [video, setVideo] = useState(night.short ? night.short.videos > 0 : night.videos > 0);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);
  const short = night.short;

  async function publish() {
    setBusy(true);
    const res = await requestJson("/api/admin/after-dark/shorts", { a: a.id, b: b.id, night_id: night.id, title, cover_id: cover, video }).catch(() => null);
    setBusy(false);
    if (!res?.ok) return setNote({ text: res?.message ?? "That didn't go through. Try again.", error: true });
    onShort(res.data.short as AdminShort);
    setNote({ text: short?.published ? "Saved." : "Published." });
  }
  async function toggle() {
    if (!short) return;
    setBusy(true);
    const res = await requestJson("/api/admin/after-dark/shorts", { id: short.id, published: !short.published }, "PATCH").catch(() => null);
    setBusy(false);
    if (!res?.ok) return setNote({ text: res?.message ?? "That didn't go through. Try again.", error: true });
    onShort(res.data.short as AdminShort);
    setNote({ text: short.published ? "Taken down: viewers no longer see it, or its teaser." : "Published again." });
  }

  const label = `${day(night.filed_at)} · ${night.chapters} chapter${night.chapters === 1 ? "" : "s"} · ${night.lines} lines${night.ended ? ` · ended ${night.ended}` : ""}`;
  if (!night.complete) {
    return (
      <li className={styles.night}>
        <strong>{label}</strong>
        <p className="muted small">Still going: 🌙 End the night files it as a whole night, then it can be a Short.</p>
      </li>
    );
  }
  return (
    <li className={styles.night}>
      <strong>{label}</strong>
      {short && (
        <p className="small">
          {short.published ? "📺 Published" : "Taken down"} · {night.views} watched · <Link href={short.path}>Open it</Link>
        </p>
      )}
      <label>
        Title (PG: it shows on the teaser)
        <input type="text" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} disabled={busy} />
      </label>
      {panel.covers.length > 0 ? (
        <fieldset>
          <legend className="small">Cover (it shows before anyone plays it: an early one gives nothing away)</legend>
          <ul className={styles.covers}>
            <li>
              <label>
                <input type="radio" name={`cover-${night.id}`} checked={cover === null} onChange={() => setCover(null)} disabled={busy} className="sr-only" />
                <span className={styles.portraitsTile}>Their portraits</span>
              </label>
            </li>
            {panel.covers.map((c) => (
              <li key={c.id}>
                <label title={[c.kind === "frame" ? "A video's keyframe" : "A picture", c.chapter ? `chapter ${c.chapter}` : "", c.place ?? "", day(c.created_at)].filter(Boolean).join(" · ")}>
                  <input type="radio" name={`cover-${night.id}`} checked={cover === c.id} onChange={() => setCover(c.id)} disabled={busy} className="sr-only" />
                  {/* eslint-disable-next-line @next/next/no-img-element -- the admin's own private picture */}
                  <img src={mediaUrl(c.id)} alt={c.kind === "frame" ? "A video's keyframe" : "A picture of the two of them"} loading="lazy" />
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      ) : (
        <p className="muted small">No pictures of the two of them yet, so the cover is their portraits.</p>
      )}
      {night.videos > 0 ? (
        <label className="small">
          <input type="checkbox" checked={video} onChange={(e) => setVideo(e.target.checked)} disabled={busy} /> With the night&apos;s video ({night.videos})
        </label>
      ) : (
        <p className="muted small">No video of this night.</p>
      )}
      <p className={styles.row}>
        <button type="button" className="primary" disabled={busy || !title.trim()} onClick={() => void publish()}>
          {busy ? "Saving…" : short?.published ? "Save changes" : short ? "Save and publish again" : "Publish as a Short"}
        </button>
        {short?.published && (
          <button type="button" className="button-ghost" disabled={busy} onClick={() => void toggle()}>
            Take it down
          </button>
        )}
      </p>
      {note && (
        <p className={note.error ? "error" : "muted small"} role="status">
          {note.text}
        </p>
      )}
    </li>
  );
}
